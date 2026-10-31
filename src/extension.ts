import { randomUUID } from "node:crypto";
import type { MachineInfo } from "@br-ia/protocol";
import * as vscode from "vscode";
import { Api } from "./api";
import { ChatViewProvider } from "./chatView";
import { registerCommands } from "./commands";
import { Connection } from "./connection";
import { Checkpoints } from "./cook/checkpoints";
import { CookExecutor } from "./cook/executor";
import { OrdersStore, OrdersTreeProvider } from "./cook/orders";
import { ProjectFolders } from "./cook/projectFolders";
import { ProposalReview } from "./cook/proposals";
import { MemoryStore } from "./memoryStore";
import { MemoryDocumentProvider, MemoryTreeProvider } from "./memoryView";
import { watchMentions } from "./notifications";
import { serverWsUrl } from "./server";
import { Session } from "./session";
import { createStatusBar } from "./statusBar";
import { TeamsTreeProvider } from "./teamsView";
import { WorkspaceStore } from "./workspaceStore";

const MACHINE_ID_KEY = "bria.machineId";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("br.ia", { log: true });
  const machine = machineInfo(context);
  const session = new Session(context);

  const api = new Api(
    () => session.token,
    () => void expireSession(),
  );
  const connection = new Connection(serverWsUrl, () => session.token, machine, log);
  const store = new WorkspaceStore(api, connection, log);
  const memory = new MemoryStore(api, connection, log);
  const chat = new ChatViewProvider(context, api, session, connection, store, memory);
  const folders = new ProjectFolders(context, connection);
  const teams = new TeamsTreeProvider(store, folders);
  const proposals = new ProposalReview();
  const checkpoints = new Checkpoints(vscode.Uri.joinPath(context.globalStorageUri, "checkpoints").fsPath);
  const orders = new OrdersStore(api, connection, log);
  const ordersTree = new OrdersTreeProvider(orders, store, checkpoints, () => chat.openProjectId);
  const executor = new CookExecutor(connection, folders, proposals, checkpoints, log, (id) =>
    orders.describe(id),
  );
  const memoryTree = new MemoryTreeProvider(memory, store);
  const memoryDocument = new MemoryDocumentProvider(memory, store);

  async function expireSession() {
    if (!session.token) return;
    await session.clear();
    void vscode.window.showWarningMessage(vscode.l10n.t("Your br.ia session has expired. Sign in again."));
  }

  const updateContext = () =>
    vscode.commands.executeCommand("setContext", "bria.connectionState", connection.state.status);
  void updateContext();

  context.subscriptions.push(
    log,
    session,
    connection,
    store,
    chat,
    teams,
    connection.onDidChangeState(updateContext),
    connection.onFailure((reason) => {
      if (reason === "unauthenticated") void expireSession();
    }),
    session.onDidChange((user) => {
      if (user) {
        connection.connect();
        void store.refresh();
      } else {
        connection.disconnect();
        store.clear();
      }
    }),
    memory,
    folders,
    proposals,
    orders,
    ordersTree,
    executor,
    executor.onDidChangeBusy((orderId) =>
      vscode.commands.executeCommand("setContext", "bria.cooking", Boolean(orderId)),
    ),
    orders.onDidFinish((order) => {
      executor.orderFinished(order.id);
      void ordersTree.refresh();
    }),
    vscode.window.registerTreeDataProvider("bria.orders", ordersTree),
    chat.onDidOpenProject((projectId) => {
      teams.setOpenProject(projectId);
      void memory.setProject(projectId);
      void orders.setProject(projectId);
    }),
    memoryTree,
    memoryDocument,
    vscode.window.registerTreeDataProvider("bria.memory", memoryTree),
    vscode.workspace.registerTextDocumentContentProvider(MemoryDocumentProvider.scheme, memoryDocument),
    createStatusBar(connection, executor),
    vscode.window.registerTreeDataProvider("bria.teams", teams),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat),
    watchMentions(connection, session, store, chat),
    ...registerCommands({
      api,
      session,
      connection,
      store,
      chat,
      memory,
      folders,
      orders,
      executor,
      proposals,
      checkpoints,
      log,
      machineId: machine.id,
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bria.serverUrl") && session.token) connection.connect();
    }),
  );

  teams.setOpenProject(chat.openProjectId);
  await session.restore();
  if (session.token) {
    void memory.setProject(chat.openProjectId);
    void orders.setProject(chat.openProjectId);
  }
}

export function deactivate(): void {}

/** Identité de cette machine, transmise au serveur. L'identifiant est créé une fois puis conservé. */
function machineInfo(context: vscode.ExtensionContext): MachineInfo {
  let id = context.globalState.get<string>(MACHINE_ID_KEY);
  if (!id) {
    id = randomUUID();
    void context.globalState.update(MACHINE_ID_KEY, id);
  }
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : process.platform === "linux"
          ? "linux"
          : "other";
  return {
    id,
    os,
    editor: vscode.env.appName,
    editorVersion: vscode.version,
    extensionVersion: String(context.extension.packageJSON.version),
  };
}
