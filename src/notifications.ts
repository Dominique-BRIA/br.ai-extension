import * as vscode from "vscode";
import type { ChatViewProvider } from "./chatView";
import type { Connection } from "./connection";
import type { OrdersStore } from "./cook/orders";
import type { Session } from "./session";
import type { WorkspaceStore } from "./workspaceStore";

/**
 * Notifie les mentions (`@Nom`), et seulement elles, quand le fil concerné
 * n'est pas déjà sous les yeux du membre. Désactivable avec « Ne plus afficher ».
 */
export function watchMentions(
  connection: Connection,
  session: Session,
  store: WorkspaceStore,
  chat: ChatViewProvider,
): vscode.Disposable {
  return connection.onEvent(async (event) => {
    if (event.type !== "message.created") return;
    const me = session.user?.id;
    const { message } = event;
    if (!me) return;
    // Une mention, ou la réponse de l'agent serveur à l'un de mes messages.
    const answersMe =
      message.author.kind === "serveur" &&
      message.replyTo?.author.kind === "member" &&
      message.replyTo.author.userId === me;
    if (!message.mentions.includes(me) && !answersMe) return;
    if (message.author.kind === "member" && message.author.userId === me) return;
    if (chat.isShowing(message.projectId) && vscode.window.state.focused) return;

    const settings = vscode.workspace.getConfiguration("bria");
    if (!settings.get<boolean>("notifyMentions", true)) return;

    const found = store.project(message.projectId);
    const author = message.author.kind === "member" ? message.author.displayName : "<br>.ia";
    const project = found?.project.name ?? "<br>.ia";
    const open = vscode.l10n.t("Open");
    const never = vscode.l10n.t("Don't show again");
    const choice = await vscode.window.showInformationMessage(
      answersMe
        ? vscode.l10n.t("<br>.ia answered you in {0}.", project)
        : vscode.l10n.t("{0} mentioned you in {1}.", author, project),
      open,
      never,
    );
    if (choice === open) await chat.open(message.projectId, true);
    if (choice === never) await settings.update("notifyMentions", false, vscode.ConfigurationTarget.Global);
  });
}

/**
 * Prévient le demandeur quand sa commande se termine, si le fil n'est pas déjà sous ses yeux.
 * Le même réglage que pour les mentions permet de couper ces notifications.
 */
export function watchFinishedOrders(
  orders: OrdersStore,
  session: Session,
  chat: ChatViewProvider,
): vscode.Disposable {
  return orders.onDidFinish(async (order) => {
    const me = session.user?.id;
    if (!me || order.requestedBy.kind !== "member" || order.requestedBy.userId !== me) return;
    if (chat.isShowing(order.projectId) && vscode.window.state.focused) return;
    const settings = vscode.workspace.getConfiguration("bria");
    if (!settings.get<boolean>("notifyMentions", true)) return;

    const open = vscode.l10n.t("Open");
    const text =
      order.status === "done"
        ? vscode.l10n.t("Order {0} is done: {1}", order.number, order.title)
        : order.status === "failed"
          ? vscode.l10n.t("Order {0} could not be completed: {1}", order.number, order.title)
          : vscode.l10n.t("Order {0} was stopped: {1}", order.number, order.title);
    const show =
      order.status === "done" ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
    if ((await show(text, open)) === open) await chat.open(order.projectId, true);
  });
}
