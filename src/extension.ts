import { randomUUID } from "node:crypto";
import type { MachineInfo } from "@br-ia/protocol";
import * as vscode from "vscode";
import { ChatViewProvider } from "./chatView";
import { Connection } from "./connection";
import { createStatusBar } from "./statusBar";

const MACHINE_ID_KEY = "bria.machineId";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("br.ia", { log: true });
  const connection = new Connection(
    () => vscode.workspace.getConfiguration("bria").get<string>("serverUrl", "ws://127.0.0.1:4000/ws"),
    machineInfo(context),
    log,
  );

  const updateContext = () =>
    vscode.commands.executeCommand("setContext", "bria.connectionState", connection.state.status);
  void updateContext();

  context.subscriptions.push(
    log,
    connection,
    connection.onDidChangeState(updateContext),
    createStatusBar(connection),
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewId,
      new ChatViewProvider(context.extensionUri, connection),
    ),
    vscode.commands.registerCommand("bria.connect", () => connection.connect()),
    vscode.commands.registerCommand("bria.disconnect", () => connection.disconnect()),
    vscode.commands.registerCommand("bria.showLog", () => log.show()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bria.serverUrl") && connection.state.status !== "disconnected") {
        connection.connect();
      }
    }),
  );

  connection.connect();
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
