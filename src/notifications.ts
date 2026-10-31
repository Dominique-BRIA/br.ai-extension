import * as vscode from "vscode";
import type { ChatViewProvider } from "./chatView";
import type { Connection } from "./connection";
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
    if (!me || !message.mentions.includes(me)) return;
    if (message.author.kind === "member" && message.author.userId === me) return;
    if (chat.isShowing(message.projectId) && vscode.window.state.focused) return;

    const settings = vscode.workspace.getConfiguration("bria");
    if (!settings.get<boolean>("notifyMentions", true)) return;

    const found = store.project(message.projectId);
    const author = message.author.kind === "member" ? message.author.displayName : "br.ia";
    const open = vscode.l10n.t("Open");
    const never = vscode.l10n.t("Don't show again");
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t("{0} mentioned you in {1}.", author, found?.project.name ?? "br.ia"),
      open,
      never,
    );
    if (choice === open) await chat.open(message.projectId, true);
    if (choice === never) await settings.update("notifyMentions", false, vscode.ConfigurationTarget.Global);
  });
}
