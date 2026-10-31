import { WS_PATH } from "@br-ia/protocol";
import * as vscode from "vscode";

const DEFAULT_SERVER = "http://127.0.0.1:4000";

/** Adresse HTTP du serveur, d'après le réglage `bria.serverUrl`. */
export function serverHttpUrl(): string {
  const raw = vscode.workspace.getConfiguration("bria").get<string>("serverUrl", DEFAULT_SERVER).trim();
  const url = new URL(raw || DEFAULT_SERVER);
  // Accepte aussi une ancienne valeur en ws:// (lot 0).
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.pathname.endsWith(WS_PATH)) url.pathname = url.pathname.slice(0, -WS_PATH.length);
  return url.toString().replace(/\/$/, "");
}

/** Adresse WebSocket correspondante. */
export function serverWsUrl(): string {
  return `${serverHttpUrl().replace(/^http/, "ws")}${WS_PATH}`;
}
