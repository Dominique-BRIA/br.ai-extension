import { WS_PATH } from "@br-ia/protocol";
import * as vscode from "vscode";

const ONLINE_SERVER = "https://br-ia-api-a8gwhdfxccd6cham.germanywestcentral-01.azurewebsites.net";
const DEVELOPMENT_SERVER = "http://127.0.0.1:4000";

let developing = false;

/** Lancée en développement, l'extension vise par défaut le serveur local, jamais la base en ligne. */
export function setDevelopmentMode(enabled: boolean): void {
  developing = enabled;
}

/**
 * Adresse HTTP du serveur : celle choisie par l'utilisateur dans ses réglages, sinon celle par
 * défaut. Le réglage d'un dossier ouvert est ignoré : un dépôt ne doit pas pouvoir détourner la
 * session vers un autre serveur.
 */
export function serverHttpUrl(): string {
  const chosen = vscode.workspace.getConfiguration("bria").inspect<string>("serverUrl")?.globalValue?.trim();
  const url = new URL(chosen || (developing ? DEVELOPMENT_SERVER : ONLINE_SERVER));
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
