import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { Connection } from "./connection";
import type { FromWebview, ToWebview, WebviewStrings } from "./webviewMessages";

/** La vue « Chat » de la barre latérale. Au lot 0, elle affiche l'état de la connexion. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "bria.chat";
  #view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: Connection,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.#html(view.webview, dist);

    const subscriptions = [
      view.webview.onDidReceiveMessage((message: FromWebview) => {
        switch (message.type) {
          case "ready":
            this.#postState();
            return;
          case "connect":
            void vscode.commands.executeCommand("bria.connect");
            return;
          case "showLog":
            void vscode.commands.executeCommand("bria.showLog");
            return;
        }
      }),
      this.connection.onDidChangeState(() => this.#postState()),
    ];
    view.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      this.#view = undefined;
    });
  }

  #postState(): void {
    const message: ToWebview = { type: "state", state: this.connection.state, strings: strings() };
    void this.#view?.webview.postMessage(message);
  }

  #html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.css"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
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
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function strings(): WebviewStrings {
  return {
    disconnectedTitle: vscode.l10n.t("Not connected"),
    disconnectedBody: vscode.l10n.t("Connect to the br.ia server to join your team's chat."),
    connectingTitle: vscode.l10n.t("Connecting…"),
    connectingBody: vscode.l10n.t(
      "br.ia is reaching the server. It will keep retrying if the server is unavailable.",
    ),
    connectedTitle: vscode.l10n.t("Connected"),
    connectedBody: vscode.l10n.t(
      "This machine is connected to the br.ia server. Team chat arrives in the next version.",
    ),
    failedTitle: vscode.l10n.t("Connection refused"),
    connect: vscode.l10n.t("Connect"),
    showLog: vscode.l10n.t("Show log"),
  };
}
