import * as vscode from "vscode";
import type { Connection, ConnectionState } from "./connection";

/** Un seul élément br.ia dans la barre d'état, sans couleur personnalisée. */
export function createStatusBar(connection: Connection): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("bria.status", vscode.StatusBarAlignment.Left, 50);
  item.name = "br.ia";
  item.command = "workbench.view.extension.bria";

  const render = (state: ConnectionState) => {
    switch (state.status) {
      case "connected":
        item.text = "$(check) br.ia";
        item.tooltip = vscode.l10n.t("Connected to the br.ia server");
        break;
      case "connecting":
        item.text = "$(sync~spin) br.ia";
        item.tooltip = vscode.l10n.t("Connecting to the br.ia server…");
        break;
      case "disconnected":
        item.text = "$(debug-disconnect) br.ia";
        item.tooltip = vscode.l10n.t("Disconnected from the br.ia server");
        break;
      case "failed":
        item.text = "$(warning) br.ia";
        item.tooltip = state.message;
        break;
    }
  };

  render(connection.state);
  item.show();
  const subscription = connection.onDidChangeState(render);
  return vscode.Disposable.from(item, subscription);
}
