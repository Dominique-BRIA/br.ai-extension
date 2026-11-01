import { randomBytes } from "node:crypto";
import type {
  CreateInvitationResponse,
  CurrentInvitationResponse,
  ListMessagesResponse,
  MemoryType,
  Message,
  Project,
  RequestCodeResponse,
  Team,
  VerifyCodeResponse,
} from "@br-ia/protocol";
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
import type {
  ChatStrings,
  ChatViewState,
  FromWebview,
  HomeForm,
  TeamInvitation,
  ToWebview,
  WebviewCommand,
} from "./webviewMessages";
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
  machineId: string;
}

/**
 * Le panneau de <br>.ia, où tout se passe : la connexion, l'accueil avec les équipes et
 * leurs projets, puis le fil de discussion du projet ouvert, sa mémoire, ses commandes et
 * son équipe. Il s'affiche dans sa vue (barre latérale de droite) et, sur demande, en
 * grand dans un onglet.
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
  /** Clé d'invitation en cours de chaque équipe dont on est chef, une fois chargée. */
  readonly #invitations = new Map<string, TeamInvitation | null>();

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
          this.#invitations.clear();
        }
        this.#post();
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

  /** Affiche le panneau : la connexion, l'accueil ou le projet ouvert. */
  async show(): Promise<void> {
    await this.#reveal();
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
    const panel = vscode.window.createWebviewPanel("bria.chatPanel", "<br>.ia", vscode.ViewColumn.Active, {
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
      case "requestCode":
        await this.#requestCode(message.email, message.invitationCode);
        return;
      case "verifyCode":
        await this.#verifyCode(message.email, message.code, message.displayName);
        return;
      case "openProject":
        await this.open(message.projectId ?? undefined);
        return;
      case "createTeam":
        await this.#form("createTeam", async () => {
          await this.#sources.api.post<{ team: Team }>("/teams", { name: message.name });
        });
        return;
      case "joinTeam":
        await this.#form("joinTeam", async () => {
          await this.#sources.api.post<{ team: Team }>("/invitations/accept", { code: message.code });
        });
        return;
      case "createProject": {
        let created: Project | undefined;
        await this.#form("createProject", async () => {
          ({ project: created } = await this.#sources.api.post<{ project: Project }>(
            `/teams/${message.teamId}/projects`,
            { name: message.name },
          ));
        });
        if (created) await this.open(created.id);
        return;
      }
      case "invitation":
        await this.#invitation(message.action);
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        return;
      case "memberAction": {
        const found = this.#projectId ? this.#sources.store.project(this.#projectId) : undefined;
        const member = found?.team.members.find((candidate) => candidate.userId === message.userId);
        if (!found || !member) return;
        // Les deux actions demandent confirmation dans une fenêtre de VS Code.
        await vscode.commands.executeCommand(
          message.action === "remove" ? "bria.removeMember" : "bria.transferChef",
          { kind: "member", team: found.team, member },
        );
        return;
      }
      case "setPermissionMode":
        // Le réglage vaut pour toute la machine ; le panneau se met à jour quand il change.
        await vscode.workspace
          .getConfiguration("bria")
          .update("permissionMode", message.mode, vscode.ConfigurationTarget.Global);
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
      case "openProjectFile":
        await this.#openProjectFile(message.path);
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
      case "newNote":
        await vscode.commands.executeCommand("bria.memory.add");
        return;
      case "invite":
        await vscode.commands.executeCommand("bria.invite", this.#teamNode());
        return;
      case "toggleLending":
        await vscode.commands.executeCommand("bria.toggleLending");
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
        const picked = await vscode.window.showQuickPick(actions, { title: "<br>.ia" });
        if (picked) await vscode.commands.executeCommand(picked.command);
        return;
      }
      case "leaveTeam":
        await vscode.commands.executeCommand("bria.leaveTeam", this.#teamNode());
        return;
      case "editProfile":
        await vscode.commands.executeCommand("bria.editProfile");
        return;
      case "manageMachines":
        await vscode.commands.executeCommand("bria.manageMachines");
        return;
      case "signOut":
        await vscode.commands.executeCommand("bria.signOut");
        return;
    }
  }

  /** Première étape de connexion : le serveur envoie un code par e-mail. */
  async #requestCode(email: string, invitationCode: string | undefined): Promise<void> {
    try {
      const { newAccount } = await this.#sources.api.post<RequestCodeResponse>("/auth/code", {
        email,
        invitationCode,
      });
      this.#postRaw({ type: "authResult", step: "requestCode", ok: true, newAccount });
    } catch (error) {
      this.#postRaw({ type: "authResult", step: "requestCode", ok: false, ...errorOf(error) });
    }
  }

  /** Seconde étape : le code reçu ouvre une session sur cette machine. */
  async #verifyCode(email: string, code: string, displayName: string | undefined): Promise<void> {
    try {
      const result = await this.#sources.api.post<VerifyCodeResponse>("/auth/verify", {
        email,
        code,
        machineId: this.#sources.machineId,
        displayName,
      });
      this.#postRaw({ type: "authResult", step: "verifyCode", ok: true });
      await this.#sources.session.signedIn(result.token, result.user);
    } catch (error) {
      this.#postRaw({ type: "authResult", step: "verifyCode", ok: false, ...errorOf(error) });
    }
  }

  /** Formulaire de l'accueil : appel au serveur, puis espace de travail rechargé. */
  async #form(form: HomeForm, run: () => Promise<void>): Promise<void> {
    try {
      await run();
      await this.#sources.store.refresh();
      this.#postRaw({ type: "formResult", form, ok: true });
    } catch (error) {
      const message =
        error instanceof ApiRequestError && error.code === "network"
          ? vscode.l10n.t("The <br>.ia server cannot be reached.")
          : (error as Error).message;
      this.#postRaw({ type: "formResult", form, ok: false, error: message });
    }
  }

  /** Clé d'invitation de l'équipe du projet ouvert : la relire, ou en créer une nouvelle. */
  async #invitation(action: "load" | "create"): Promise<void> {
    const found = this.#projectId ? this.#sources.store.project(this.#projectId) : undefined;
    if (found?.team.myRole !== "chef") return;
    const teamId = found.team.id;
    try {
      if (action === "load") {
        const { invitation } = await this.#sources.api.get<CurrentInvitationResponse>(
          `/teams/${teamId}/invitations/current`,
        );
        this.#invitations.set(teamId, invitation);
      } else {
        const created = await this.#sources.api.post<CreateInvitationResponse>(
          `/teams/${teamId}/invitations`,
        );
        this.#invitations.set(teamId, created);
      }
      this.#post();
    } catch (error) {
      this.#reportError(error);
    }
  }

  #teamNode() {
    const found = this.#projectId ? this.#sources.store.project(this.#projectId) : undefined;
    return found ? { kind: "team" as const, team: found.team } : undefined;
  }

  /** Ouvre un fichier produit par le cuisinier, s'il est présent sur cette machine. */
  async #openProjectFile(path: string): Promise<void> {
    const root = this.#projectId ? this.#sources.folders.get(this.#projectId) : undefined;
    if (!root) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("Link a folder to this project to open its files on this machine."),
      );
      return;
    }
    const file = vscode.Uri.joinPath(vscode.Uri.file(root), path);
    try {
      await vscode.workspace.fs.stat(file);
    } catch {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("{0} is not on this machine yet. Get the latest version first.", path),
      );
      return;
    }
    await vscode.commands.executeCommand(
      path.toLowerCase().endsWith(".md") ? "markdown.showPreview" : "vscode.open",
      file,
    );
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
    if (!found) {
      return {
        view: "home",
        user: { displayName: user.displayName, email: user.email },
        teams:
          store.current?.teams.map((team) => ({
            id: team.id,
            name: team.name,
            isChef: team.myRole === "chef",
            memberCount: team.members.length,
            onlineCount: team.members.filter((member) => member.online).length,
            projects: team.projects.map(({ id, name }) => ({ id, name })),
          })) ?? null,
      };
    }
    return {
      view: "project",
      projectId: found.project.id,
      projectName: found.project.name,
      teamId: found.team.id,
      teamName: found.team.name,
      chefName: found.team.members.find((member) => member.role === "chef")?.displayName ?? "",
      invitation: this.#invitations.get(found.team.id),
      myUserId: user.id,
      isChef: found.team.myRole === "chef",
      members: found.team.members.map(({ userId, displayName, role, online, lastSeenAt }) => ({
        userId,
        displayName,
        role,
        online,
        lastSeenAt,
      })),
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
    const media = (file: string) => vscode.Uri.joinPath(this.context.extensionUri, "media", file);
    for (const webview of webviews) {
      const message: ToWebview = {
        type: "state",
        state: this.#state(),
        connection: this.#sources.connection.state,
        strings: chatStrings(),
        locale: vscode.env.language,
        logoUri: webview.asWebviewUri(media("logo.png")).toString(),
        wordmarkUri: webview.asWebviewUri(media("logo-complet.png")).toString(),
      };
      void webview.postMessage(message);
    }
  }

  #postRaw(message: ToWebview): void {
    void this.#view?.webview.postMessage(message);
    void this.#panel?.webview.postMessage(message);
  }

  #reportError(error: unknown): void {
    if (error instanceof ApiRequestError && error.code === "network") {
      void vscode.window.showErrorMessage(vscode.l10n.t("The <br>.ia server cannot be reached."));
      return;
    }
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

/** Erreur transmise à la webview : son code choisit le texte, sinon le message du serveur s'affiche. */
function errorOf(error: unknown): { error: string; message: string } {
  return error instanceof ApiRequestError
    ? { error: error.code, message: error.message }
    : { error: "unknown", message: String(error) };
}

function chatStrings(): ChatStrings {
  const t = vscode.l10n.t;
  return {
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
    composerPlaceholder: t("Message to <br>.ia…"),
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
    modeDetails: {
      manual: t("You approve each change (side-by-side view) and each command."),
      autoEdit: t("Changes are applied directly; you approve each command."),
      auto: t("Changes and commands run directly, except risky commands."),
      plan: t("The cook reads and proposes, but changes nothing on this machine."),
    },
    modeTitle: t("What the cook may do on this machine"),
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
    tabTeam: t("Team"),
    online_pill: t("ONLINE"),
    ordersInProgress: t("Orders in progress"),
    activeCount: t("{0} ACTIVE"),
    requestedBy: t("Requested by {0}"),
    stepOf: t("Step {0}: {1}"),
    cook: t("Cook"),
    onMachine: t("on {0}'s machine"),
    waitingMachine: t("waiting for a machine"),
    cookStatus: { busy: t("Working"), ready: t("Available"), waiting: t("Waiting") },
    viewStream: t("View the stream"),
    details: t("Details"),
    filterAll: t("All ({0})"),
    filterRunning: t("In progress ({0})"),
    filterDone: t("Finished ({0})"),
    finishedAgo: t("Finished {0}"),
    startsWhenMachine: t("Will start as soon as a machine is available"),
    queuePosition: t("Queue: #{0}"),
    openFile: t("Open"),
    memoryTitle: t("Memory & Documents"),
    memorySubtitle: t("Knowledge base of the {0} project"),
    inProgress: t("Being prepared"),
    byCook: t("In progress by the cook"),
    preview: t("Preview the draft"),
    recentDocuments: t("Recent documents"),
    fileCount: t("{0} FILE(S)"),
    fromOrder: t("Order {0}"),
    activeDecision: t("ACTIVE DECISION"),
    newNote: t("New note"),
    teamTitle: t("{0} team"),
    workspace: t("TEAM · {0}"),
    teamStats: t("{0} human(s) · {1} AI agents"),
    teamMembers: t("Team members"),
    activeMembers: t("{0} ONLINE"),
    aiAgents: t("AI agents"),
    serveurRole: t("Listens, takes notes and settles"),
    cuisinierRole: t("Writes code and documents on your machines"),
    agentActive: t("Active"),
    agentUnavailable: t("Unavailable"),
    roleChef: t("Team lead"),
    roleMember: t("Member"),
    youBadge: t("You"),
    onlineNow: t("Online"),
    seenAgo: t("Seen {0}"),
    neverSeen: t("Never connected"),
    invite: t("Invite"),
    lendMachine: t("Lend my machine"),
    authWelcome: t("Welcome"),
    authIntro: t("Sign in with your email address. We send you a 6-digit code: no password to remember."),
    emailLabel: t("Email address"),
    emailPlaceholder: t("name@example.org"),
    getCode: t("Receive a code"),
    invitationTitle: t("Invitation code"),
    invitationIntro: t(
      "The beta is private. Enter the beta code you received, or the key of the team you are joining.",
    ),
    invitationLabel: t("Beta code or team key"),
    continue: t("Continue"),
    nameTitle: t("Your name"),
    nameIntro: t("The name your team will see in the chat."),
    nameLabel: t("Display name"),
    codeTitle: t("Check your email"),
    codeIntro: t("Enter the 6-digit code sent to {0}."),
    codeLabel: t("Sign-in code"),
    signInButton: t("Sign in"),
    resendCode: t("Resend the code"),
    codeResent: t("A new code has been sent."),
    changeEmail: t("Use another address"),
    back: t("Back"),
    invalidEmail: t("Enter a valid email address."),
    codeInvalid: t("Incorrect or expired code. Try again."),
    invitationInvalid: t("This invitation code is not valid."),
    codeAlreadySent: t("A code was sent less than a minute ago: use it, or wait before asking for another."),
    serverUnreachable: t("The <br>.ia server cannot be reached."),
    authFooter: t("Your session stays on this machine, in the VS Code secret storage."),
    homeGreeting: t("Hello {0}"),
    homeIntro: t("Choose a project to open its chat."),
    yourTeams: t("Your teams"),
    noTeamsTitle: t("Start with a team"),
    noTeamsBody: t("Create your team, or join one with the key given by its lead."),
    createTeam: t("Create a team"),
    teamNamePlaceholder: t("Team name"),
    joinTeam: t("Join a team"),
    teamKeyPlaceholder: "EQP-XXXX-XXXX",
    join: t("Join"),
    create: t("Create"),
    cancel: t("Cancel"),
    newProject: t("New project"),
    projectNamePlaceholder: t("Project name"),
    noProjects: t("No project yet."),
    projectCount: t("{0} project(s)"),
    account: t("Account"),
    editProfile: t("Edit my profile"),
    machines: t("My machines"),
    signOut: t("Sign out"),
    allProjects: t("All projects"),
    inviteKeyTitle: t("Invitation key"),
    inviteKeyIntro: t("Share this key: it lets a teammate create an account or join {0}."),
    inviteKeyNone: t("No valid key. Generate one to invite teammates."),
    inviteKeyMember: t("Only the team lead can invite. Ask {0} for a key."),
    generateKey: t("Generate a key"),
    newKey: t("New key"),
    copy: t("Copy"),
    copied: t("Copied"),
    validUntil: t("Valid until {0}"),
    leaveTeam: t("Leave the team"),
    removeMember: t("Remove from the team"),
    makeChef: t("Make team lead"),
  };
}
