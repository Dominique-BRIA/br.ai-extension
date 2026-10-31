import type { ConnectionState } from "./connection";

/** Textes de l'interface, traduits côté extension puis transmis à la webview. */
export interface WebviewStrings {
  disconnectedTitle: string;
  disconnectedBody: string;
  connectingTitle: string;
  connectingBody: string;
  connectedTitle: string;
  connectedBody: string;
  failedTitle: string;
  connect: string;
  showLog: string;
}

/** Extension → webview. */
export type ToWebview = { type: "state"; state: ConnectionState; strings: WebviewStrings };

/** Webview → extension. */
export type FromWebview = { type: "ready" } | { type: "connect" } | { type: "showLog" };
