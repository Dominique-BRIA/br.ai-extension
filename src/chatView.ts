import { randomBytes } from "node:crypto";
import type { ListMessagesResponse, MemoryType, Message } from "@br-ia/protocol";
import * as vscode from "vscode";
import { type Api, ApiRequestError } from "./api";
import { openAttachment, pickAndUpload } from "./attachments";
import type { Connection } from "./connection";
import type { MemoryStore } from "./memoryStore";
import type { Session } from "./session";
import type { ChatStrings, ChatViewState, FromWebview, ToWebview } from "./webviewMessages";
import type { WorkspaceStore } from "./workspaceStore";

const OPEN_PROJECT_KEY = "bria.openProjectId";

/** La vue « Chat » : le fil de discussion du projet ouvert. */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "bria.chat";

  readonly #onDidOpenProject = new vscode.EventEmitter<string | undefined>();
  readonly onDidOpenProject = this.#onDidOpenProject.event;
  readonly #subscriptions: vscode.Disposable[];
  #view: vscode.WebviewView | undefined;
  #projectId: string | undefined;
  #messages: Message[] = [];
  #hasMore = false;
  #loadingOlder = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: Api,
    private readonly session: Session,
    private readonly connection: Connection,
    private readonly store: WorkspaceStore,
    private readonly memory: MemoryStore,
  ) {
    this.#projectId = context.workspaceState.get<string>(OPEN_PROJECT_KEY);
    this.#subscriptions = [
      connection.onDidChangeState(() => this.#post()),
      memory.onDidChange(() => this.#post()),
      connection.onEvent((event) => {
        if (event.type === "message.created" && event.message.projectId === this.#projectId) {
          this.#append(event.message);
        }
      }),
      store.onDidChange(() => {
        if (this.#projectId && store.current && !store.project(this.#projectId)) {
          void this.open(undefined);
        } else {
          this.#post();
        }
      }),
      session.onDidChange((user) => {
        if (!user) {
          this.#messages = [];
          this.#post();
        }
      }),
      // Après une reconnexion, des messages ont pu arriver : on recharge le fil.
      connection.onDidChangeState((state) => {
        if (state.status === "connected" && this.#projectId) void this.#loadLatest();
      }),
    ];
  }

  get openProjectId(): string | undefined {
    return this.#projectId;
  }

  /** Ouvre le fil d'un projet (ou aucun) et affiche la vue. */
  async open(projectId: string | undefined, reveal = false): Promise<void> {
    this.#projectId = projectId;
    this.#messages = [];
    this.#hasMore = false;
    await this.context.workspaceState.update(OPEN_PROJECT_KEY, projectId);
    this.#onDidOpenProject.fire(projectId);
    this.#post();
    if (reveal) await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    if (projectId) await this.#loadLatest();
  }

  /** Fait défiler le fil jusqu'à un message chargé ; renvoie faux s'il n'est pas chargé. */
  async reveal(messageId: string): Promise<boolean> {
    if (!this.#messages.some((message) => message.id === messageId)) return false;
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    this.#postRaw({ type: "reveal", messageId });
    return true;
  }

  /** Vrai si la vue est visible et montre ce projet. */
  isShowing(projectId: string): boolean {
    return Boolean(this.#view?.visible) && this.#projectId === projectId;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.#html(view.webview, dist);

    const subscriptions = [
      view.webview.onDidReceiveMessage((message: FromWebview) => this.#onMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) this.#post();
      }),
    ];
    view.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      this.#view = undefined;
    });
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidOpenProject.dispose();
  }

  async #onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case "ready":
        this.#post();
        if (this.#projectId && this.#messages.length === 0) await this.#loadLatest();
        return;
      case "signIn":
        await vscode.commands.executeCommand("bria.signIn");
        return;
      case "connect":
        await vscode.commands.executeCommand("bria.connect");
        return;
      case "showLog":
        await vscode.commands.executeCommand("bria.showLog");
        return;
      case "loadOlder":
        await this.#loadOlder();
        return;
      case "send":
        await this.#send(message.body, message.replyToId, message.mentions, message.attachmentIds);
        return;
      case "attach":
        await this.#attach(message.pending);
        return;
      case "openAttachment":
        await openAttachment(this.api, message.attachment, message.save).catch((error) =>
          this.#reportError(error),
        );
        return;
    }
  }

  async #loadLatest(): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId || !this.session.token) return;
    try {
      const page = await this.api.get<ListMessagesResponse>(`/projects/${projectId}/messages`);
      if (projectId !== this.#projectId) return;
      this.#messages = page.messages;
      this.#hasMore = page.hasMore;
      this.#post();
    } catch (error) {
      this.#reportError(error);
    }
  }

  async #loadOlder(): Promise<void> {
    const projectId = this.#projectId;
    const oldest = this.#messages[0];
    if (!projectId || !oldest || this.#loadingOlder) return;
    this.#loadingOlder = true;
    this.#post();
    try {
      const page = await this.api.get<ListMessagesResponse>(
        `/projects/${projectId}/messages?before=${oldest.id}`,
      );
      if (projectId !== this.#projectId) return;
      this.#messages = [...page.messages, ...this.#messages];
      this.#hasMore = page.hasMore;
    } catch (error) {
      this.#reportError(error);
    } finally {
      this.#loadingOlder = false;
      this.#post();
    }
  }

  async #attach(pending: number): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId) return;
    try {
      const attachments = await pickAndUpload(this.api, projectId, pending);
      if (attachments.length > 0) this.#postRaw({ type: "attached", projectId, attachments });
    } catch (error) {
      this.#reportError(error);
    }
  }

  async #send(
    body: string,
    replyToId: string | undefined,
    mentions: string[],
    attachmentIds: string[],
  ): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId) return;
    try {
      const { message } = await this.api.post<{ message: Message }>(`/projects/${projectId}/messages`, {
        body,
        replyToId,
        mentions,
        attachmentIds,
      });
      this.#append(message);
      this.#postRaw({ type: "sendResult", ok: true });
    } catch (error) {
      this.#postRaw({ type: "sendResult", ok: false });
      this.#reportError(error);
    }
  }

  /** Ajoute un message s'il n'est pas déjà là (il peut arriver par l'API et par le temps réel). */
  #append(message: Message): void {
    if (this.#messages.some((existing) => existing.id === message.id)) return;
    this.#messages = [...this.#messages, message];
    this.#post();
  }

  #state(): ChatViewState {
    const user = this.session.user;
    if (!this.session.token || !user) return { view: "signedOut" };
    const found = this.#projectId ? this.store.project(this.#projectId) : undefined;
    if (!found) return { view: "noProject" };
    return {
      view: "project",
      projectId: found.project.id,
      projectName: found.project.name,
      teamName: found.team.name,
      myUserId: user.id,
      members: found.team.members.map(({ userId, displayName }) => ({ userId, displayName })),
      messages: this.#messages,
      hasMore: this.#hasMore,
      loadingOlder: this.#loadingOlder,
      notes: this.#notes(),
    };
  }

  #notes(): Record<string, MemoryType[]> {
    const notes: Record<string, MemoryType[]> = {};
    for (const item of this.memory.items) {
      if (!item.sourceMessageId || item.status === "stopped") continue;
      const types = (notes[item.sourceMessageId] ??= []);
      if (!types.includes(item.type)) types.push(item.type);
    }
    return notes;
  }

  #post(): void {
    this.#postRaw({
      type: "state",
      state: this.#state(),
      connection: this.connection.state,
      strings: chatStrings(),
      locale: vscode.env.language,
    });
  }

  #postRaw(message: ToWebview): void {
    void this.#view?.webview.postMessage(message);
  }

  #reportError(error: unknown): void {
    const text = error instanceof ApiRequestError ? error.message : String(error);
    void vscode.window.showErrorMessage(text);
  }

  #html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.css"));
    // Mermaid n'est chargé qu'à l'affichage du premier diagramme.
    const mermaid = webview.asWebviewUri(vscode.Uri.joinPath(dist, "mermaid.js"));
    const csp = [
      "default-src 'none'",
      // Les diagrammes Mermaid sont des SVG qui contiennent leurs propres styles.
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} https: data:`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <div id="root" data-mermaid="${mermaid}"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function chatStrings(): ChatStrings {
  const t = vscode.l10n.t;
  return {
    signedOutTitle: t("Not signed in"),
    signedOutBody: t("Sign in to join your team's chat."),
    signIn: t("Sign in"),
    noProjectTitle: t("No project open"),
    noProjectBody: t("Choose a project in the Teams view, or create one."),
    emptyChatTitle: t("No messages yet"),
    emptyChatBody: t("Write the first message. Type @ to mention a teammate."),
    connecting: t("Reconnecting to the server… Messages will arrive once connected."),
    disconnected: t("Not connected to the server."),
    connect: t("Connect"),
    showLog: t("Show log"),
    loadOlder: t("Load older messages"),
    loading: t("Loading…"),
    reply: t("Reply"),
    replyingTo: t("Replying to {0}"),
    cancelReply: t("Cancel reply"),
    composerPlaceholder: t("Message"),
    composerHint: t("Enter to send, Shift+Enter for a new line"),
    send: t("Send"),
    today: t("Today"),
    yesterday: t("Yesterday"),
    formerMember: t("Former member"),
    serveur: t("server agent"),
    cuisinier: t("cook agent"),
    mentionsYou: t("Mentions you"),
    you: t("{0} (you)"),
    attach: t("Attach files"),
    removeAttachment: t("Remove attachment"),
    download: t("Save as…"),
    diagramError: t("This diagram could not be drawn."),
    noted: {
      decision: t("Decision noted"),
      question: t("Open question noted"),
      task: t("Task noted"),
      compromise: t("Compromise proposed"),
    },
  };
}
