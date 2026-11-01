import * as vscode from "vscode";
import type { Connection } from "./connection";
import type { CookExecutor } from "./cook/executor";

/** Un seul élément <br>.ia dans la barre d'état, sans couleur personnalisée. */
export function createStatusBar(connection: Connection, executor: CookExecutor): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("bria.status", vscode.StatusBarAlignment.Left, 50);
  item.name = "<br>.ia";

  const render = () => {
    const state = connection.state;
    item.command = "workbench.view.extension.bria";
    if (state.status === "connected" && executor.busyOrder) {
      item.text = "$(tools) <br>.ia";
      item.tooltip = vscode.l10n.t("The cook is working on this machine. Click to see the order.");
      item.command = "bria.orders.focus";
      return;
    }
    switch (state.status) {
      case "connected":
        item.text = "$(check) <br>.ia";
        item.tooltip = vscode.l10n.t("Connected to the <br>.ia server");
        break;
      case "connecting":
        item.text = "$(sync~spin) <br>.ia";
        item.tooltip = vscode.l10n.t("Connecting to the <br>.ia server…");
        break;
      case "disconnected":
        item.text = "$(debug-disconnect) <br>.ia";
        item.tooltip = vscode.l10n.t("Disconnected from the <br>.ia server");
        break;
      case "failed":
        item.text = "$(warning) <br>.ia";
        item.tooltip = state.message;
        break;
    }
  };

  render();
  item.show();
  return vscode.Disposable.from(item, connection.onDidChangeState(render), executor.onDidChangeBusy(render));
}
