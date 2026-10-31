import { randomBytes } from "node:crypto";
import type { ListMessagesResponse, MemoryType, Message } from "@br-ia/protocol";
import * as vscode from "vscode";
import { type Api, ApiRequestError } from "./api";
import { openAttachment, pickAndUpload } from "./attachments";
import type { Connection } from "./connection";
import type { Checkpoints } from "./cook/checkpoints";
import type { PermissionMode } from "./cook/executor";
import type { OrdersStore } from "./cook/orders";
import type { ProjectFolders } from "./cook/projectFolders";
import type { MemoryStore } from "./memoryStore";
import type { Session } from "./session";
import type { ChatStrings, ChatViewState, FromWebview, ToWebview, WebviewCommand } from "./webviewMessages";
import type { WorkspaceStore } from "./workspaceStore";

const OPEN_PROJECT_KEY = "bria.openProjectId";

export interface ChatSources {
  api: Api;
  session: Session;
  connection: Connection;
  store: WorkspaceStore;
  memory: MemoryStore;
  orders: OrdersStore;
  folders: ProjectFolders;
  checkpoints: Checkpoints;
}

/**
 * Le panneau de br.ia : le fil de discussion du projet ouvert, sa mémoire et ses commandes.
 * Il s'affiche dans sa vue (barre latérale de droite) et, sur demande, en grand dans un onglet.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "bria.chat";

  readonly #onDidOpenProject = new vscode.EventEmitter<string | undefined>();
  readonly onDidOpenProject = this.#onDidOpenProject.event;
  readonly #subscriptions: vscode.Disposable[];
  readonly #sources: ChatSources;
  #view: vscode.WebviewView | undefined;
  /** Le chat ouvert en grand dans un onglet de l'éditeur. */
  #panel: vscode.WebviewPanel | undefined;
  #projectId: string | undefined;
  #messages: Message[] = [];
  #hasMore = false;
  #loadingOlder = false;
  #revertable: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    sources: ChatSources,
  ) {
    this.#sources = sources;
    const { connection, store, memory, orders, folders, session } = sources;
    this.#projectId = context.workspaceState.get<string>(OPEN_PROJECT_KEY);
    this.#subscriptions = [
      connection.onDidChangeState(() => this.#post()),
      memory.onDidChange(() => this.#post()),
      orders.onDidChange(() => void this.#refreshRevertable()),
      folders.onDidChange(() => this.#post()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("bria.permissionMode")) this.#post();
      }),
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
    if (reveal) await this.#reveal();
    if (projectId) await this.#loadLatest();
  }

  /** Fait défiler le fil jusqu'à un message chargé ; renvoie faux s'il n'est pas chargé. */
  async reveal(messageId: string): Promise<boolean> {
    if (!this.#messages.some((message) => message.id === messageId)) return false;
    await this.#reveal();
    this.#postRaw({ type: "reveal", messageId });
    return true;
  }

  /** Vrai si le chat est visible et montre ce projet. */
  isShowing(projectId: string): boolean {
    return (Boolean(this.#view?.visible) || Boolean(this.#panel?.visible)) && this.#projectId === projectId;
  }

  /** Ouvre le chat en grand, dans un onglet de l'éditeur. */
  openInEditor(): void {
    if (this.#panel) {
      this.#panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel("bria.chatPanel", "br.ia", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: this.#roots(),
      retainContextWhenHidden: true,
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "logo.png");
    panel.webview.html = this.#html(panel.webview);
    this.#panel = panel;
    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: FromWebview) => this.#onMessage(message)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) this.#post();
      }),
    ];
    panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      this.#panel = undefined;
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: this.#roots() };
    view.webview.html = this.#html(view.webview);

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
    this.#panel?.dispose();
    this.#onDidOpenProject.dispose();
  }

  async #reveal(): Promise<void> {
    if (this.#panel) this.#panel.reveal();
    else await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
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
      case "refresh":
        await Promise.all([
          this.#loadLatest(),
          this.#sources.memory.refresh(),
          this.#sources.orders.refresh(),
          this.#sources.store.refresh(),
        ]);
        return;
      case "send":
        await this.#send(message.body, message.replyToId, message.mentions, message.attachmentIds);
        return;
      case "attach":
        await this.#attach(message.pending);
        return;
      case "openAttachment":
        await openAttachment(this.#sources.api, message.attachment, message.save).catch((error) =>
          this.#reportError(error),
        );
        return;
      case "memoryStatus": {
        const item = this.#sources.memory.items.find((candidate) => candidate.id === message.itemId);
        if (!item) return;
        // L'arrêt d'une décision passe par la commande, qui demande confirmation.
        if (message.status === "stopped") {
          await vscode.commands.executeCommand("bria.memory.stop", { kind: "item", item });
        } else {
          await vscode.commands.executeCommand(
            message.status === "open" ? "bria.memory.reopen" : "bria.memory.resolve",
            { kind: "item", item },
          );
        }
        return;
      }
      case "orderAction": {
        const order = this.#sources.orders.orders.find((candidate) => candidate.id === message.orderId);
        if (!order) return;
        await vscode.commands.executeCommand(
          message.action === "stop" ? "bria.order.stop" : "bria.order.revert",
          { kind: "order", order },
        );
        return;
      }
      case "command":
        await this.#runCommand(message.command);
        return;
    }
  }

  async #runCommand(command: WebviewCommand): Promise<void> {
    switch (command) {
      case "showCookTerminal":
        await vscode.commands.executeCommand("bria.showCookTerminal");
        return;
      case "openMemoryDocument":
        await vscode.commands.executeCommand("bria.memory.openDocument");
        return;
      case "setPermissionMode":
        await vscode.commands.executeCommand("bria.setPermissionMode");
        return;
      case "openChatInEditor":
        this.openInEditor();
        return;
      case "linkFolder": {
        const found = this.#projectId ? this.#sources.store.project(this.#projectId) : undefined;
        if (found) await vscode.commands.executeCommand("bria.linkFolder", { kind: "project", ...found });
        return;
      }
      case "menu": {
        const t = vscode.l10n.t;
        const actions: { label: string; command: string }[] = [
          {
            label: `$(link-external) ${t("Open the chat in a large tab")}`,
            command: "bria.openChatInEditor",
          },
          { label: `$(terminal) ${t("Show what the cook runs")}`, command: "bria.showCookTerminal" },
          { label: `$(shield) ${t("Choose what the cook may do")}`, command: "bria.setPermissionMode" },
          { label: `$(vm-connect) ${t("Lend / stop lending this machine")}`, command: "bria.toggleLending" },
          {
            label: `$(open-preview) ${t("Open the memory as a document")}`,
            command: "bria.memory.openDocument",
          },
          { label: `$(person-add) ${t("Invite to the team")}`, command: "bria.invite" },
          { label: `$(account) ${t("Edit my profile")}`, command: "bria.editProfile" },
        ];
        const picked = await vscode.window.showQuickPick(actions, { title: "br.ia" });
        if (picked) await vscode.commands.executeCommand(picked.command);
        return;
      }
    }
  }

  async #loadLatest(): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId || !this.#sources.session.token) return;
    try {
      const page = await this.#sources.api.get<ListMessagesResponse>(`/projects/${projectId}/messages`);
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
      const page = await this.#sources.api.get<ListMessagesResponse>(
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
      const attachments = await pickAndUpload(this.#sources.api, projectId, pending);
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
      const { message } = await this.#sources.api.post<{ message: Message }>(
        `/projects/${projectId}/messages`,
        { body, replyToId, mentions, attachmentIds },
      );
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

  async #refreshRevertable(): Promise<void> {
    const revertable: string[] = [];
    for (const order of this.#sources.orders.orders) {
      if (await this.#sources.checkpoints.has(order.id)) revertable.push(order.id);
    }
    this.#revertable = revertable;
    this.#post();
  }

  #state(): ChatViewState {
    const { session, store, memory, orders, folders } = this.#sources;
    const user = session.user;
    if (!session.token || !user) return { view: "signedOut" };
    const found = this.#projectId ? store.project(this.#projectId) : undefined;
    if (!found) return { view: "noProject" };
    return {
      view: "project",
      projectId: found.project.id,
      projectName: found.project.name,
      teamName: found.team.name,
      myUserId: user.id,
      isChef: found.team.myRole === "chef",
      members: found.team.members.map(({ userId, displayName }) => ({ userId, displayName })),
      onlineCount: found.team.members.filter((member) => member.online).length,
      messages: this.#messages,
      hasMore: this.#hasMore,
      loadingOlder: this.#loadingOlder,
      notes: this.#notes(),
      memory: memory.projectId === found.project.id ? memory.items : [],
      orders: orders.orders.filter((order) => order.projectId === found.project.id),
      revertable: this.#revertable,
      folderLinked: Boolean(folders.get(found.project.id)),
      permissionMode: vscode.workspace
        .getConfiguration("bria")
        .get<PermissionMode>("permissionMode", "manual"),
    };
  }

  #notes(): Record<string, MemoryType[]> {
    const notes: Record<string, MemoryType[]> = {};
    for (const item of this.#sources.memory.items) {
      if (!item.sourceMessageId || item.status === "stopped") continue;
      const types = notes[item.sourceMessageId] ?? [];
      if (!types.includes(item.type)) types.push(item.type);
      notes[item.sourceMessageId] = types;
    }
    return notes;
  }

  #post(): void {
    const webviews = [this.#view?.webview, this.#panel?.webview].filter((webview) => webview !== undefined);
    for (const webview of webviews) {
      const message: ToWebview = {
        type: "state",
        state: this.#state(),
        connection: this.#sources.connection.state,
        strings: chatStrings(),
        locale: vscode.env.language,
        logoUri: webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "logo.png"))
          .toString(),
      };
      void webview.postMessage(message);
    }
  }

  #postRaw(message: ToWebview): void {
    void this.#view?.webview.postMessage(message);
    void this.#panel?.webview.postMessage(message);
  }

  #reportError(error: unknown): void {
    const text = error instanceof ApiRequestError ? error.message : String(error);
    void vscode.window.showErrorMessage(text);
  }

  #roots(): vscode.Uri[] {
    return [
      vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      vscode.Uri.joinPath(this.context.extensionUri, "media"),
    ];
  }

  #html(webview: vscode.Webview): string {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
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
    composerPlaceholder: t("Message to br.ia…"),
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
      decision: t("Decision noted in the project memory"),
      question: t("Open question noted in the project memory"),
      task: t("Task noted in the project memory"),
      compromise: t("Compromise proposed"),
    },
    beta: t("BETA"),
    online: t("{0}/{1} online"),
    refresh: t("Refresh"),
    more: t("More actions"),
    tabChat: t("Chat"),
    tabMemory: t("Memory"),
    tabOrders: t("Orders"),
    order: t("Order {0}"),
    orderStatus: {
      pending: t("waiting"),
      running: t("in progress"),
      done: t("done"),
      failed: t("not completed"),
      stopped: t("stopped"),
    },
    assignedTo: t("Assigned to: cook, on {0}'s machine"),
    assignedNobody: t("Assigned to: cook, waiting for a machine"),
    noFolder: t("No folder is linked to this project on this machine."),
    linkFolder: t("Link a folder"),
    stopOrder: t("Stop"),
    revertOrder: t("Undo changes"),
    showTerminal: t("Terminal"),
    steps: t("Steps"),
    noOrders: t(
      "No order yet. Ask for a deliverable in the chat: the server agent passes the order to the cook.",
    ),
    mode: t("Mode: {0}"),
    modes: { manual: t("Manual"), autoEdit: t("Auto edit"), auto: t("Auto"), plan: t("Plan") },
    changeMode: t("Change"),
    memoryGroups: {
      decision: t("Decisions"),
      question: t("Open questions"),
      task: t("Tasks"),
      compromise: t("Compromises under discussion"),
      history: t("History"),
    },
    memoryStatus: { open: t("open"), resolved: t("resolved"), stopped: t("stopped") },
    noMemory: t(
      "Nothing noted yet. The server agent records here the decisions, open questions, tasks and compromises from the chat.",
    ),
    resolve: t("Mark as resolved"),
    reopen: t("Reopen"),
    stopDecision: t("Stop the decision"),
    showInChat: t("Show in chat"),
    openMemoryDocument: t("Open as document"),
    quickStatus: t("status"),
    quickStatusMessage: t("@bria where are the orders and tasks of the project?"),
    quickMemory: t("Memory (.md)"),
    quickTerminal: t("Cook terminal"),
  };
}
