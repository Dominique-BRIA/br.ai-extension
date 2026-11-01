import type { Notification, NotificationsResponse } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "./api";
import type { Connection } from "./connection";
import type { Session } from "./session";

const SEEN_KEY = "bria.notificationsSeenAt";

/**
 * Les notifications du membre (mentions, réponses de l'IA, commandes terminées), rechargées
 * quand un événement peut en ajouter une. Le moment de la dernière consultation reste sur la
 * machine : ce qui est plus récent compte comme non lu.
 */
export class NotificationsStore implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #subscriptions: vscode.Disposable[];
  #items: Notification[] = [];
  #reload: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: Api,
    connection: Connection,
    private readonly session: Session,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.#subscriptions = [
      connection.onEvent((event) => {
        const me = this.session.user?.id;
        if (!me) return;
        const concernsMe =
          (event.type === "message.created" &&
            (event.message.mentions.includes(me) ||
              (event.message.replyTo?.author.kind === "member" &&
                event.message.replyTo.author.userId === me))) ||
          (event.type === "order.updated" &&
            ["done", "failed", "stopped"].includes(event.order.status) &&
            event.order.requestedBy.kind === "member" &&
            event.order.requestedBy.userId === me);
        if (concernsMe) this.#scheduleReload();
      }),
      connection.onDidChangeState((state) => {
        if (state.status === "connected") void this.refresh();
      }),
      session.onDidChange((user) => {
        if (!user) {
          this.#items = [];
          this.#onDidChange.fire();
        }
      }),
    ];
  }

  get items(): Notification[] {
    return this.#items;
  }

  get unread(): number {
    const seen = this.context.globalState.get<string>(SEEN_KEY) ?? "";
    return this.#items.filter((item) => item.createdAt > seen).length;
  }

  /** Tout ce qui est affiché compte désormais comme lu. */
  async markSeen(): Promise<void> {
    const latest = this.#items[0]?.createdAt;
    if (!latest || this.unread === 0) return;
    await this.context.globalState.update(SEEN_KEY, latest);
    this.#onDidChange.fire();
  }

  async refresh(): Promise<void> {
    if (!this.session.token) return;
    try {
      this.#items = (await this.api.get<NotificationsResponse>("/me/notifications")).notifications;
      this.#onDidChange.fire();
    } catch (error) {
      this.log.warn(`Chargement des notifications impossible : ${(error as Error).message}`);
    }
  }

  dispose(): void {
    clearTimeout(this.#reload);
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChange.dispose();
  }

  /** Plusieurs événements rapprochés ne déclenchent qu'un rechargement. */
  #scheduleReload(): void {
    clearTimeout(this.#reload);
    this.#reload = setTimeout(() => void this.refresh(), 800);
  }
}
