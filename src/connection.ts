import {
  type ClientMessage,
  type MachineInfo,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerEvent,
  type ServerMessage,
} from "@br-ia/protocol";
import * as vscode from "vscode";
import WebSocket from "ws";
import { reconnectDelay } from "./backoff";

export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting"; attempt: number }
  | { status: "connected"; serverVersion: string }
  /** Erreur qui empêche de se reconnecter seul, par exemple une extension trop ancienne. */
  | { status: "failed"; message: string };

export type FailureReason = "protocol_mismatch" | "unauthenticated";

const HEARTBEAT_MS = 30_000;

/**
 * Connexion permanente au serveur <br/>, avec reconnexion automatique.
 */
export class Connection implements vscode.Disposable {
  readonly #onDidChangeState = new vscode.EventEmitter<ConnectionState>();
  readonly onDidChangeState = this.#onDidChangeState.event;
  readonly #onEvent = new vscode.EventEmitter<ServerEvent>();
  /** Événements poussés par le serveur : nouveaux messages, présence, changements d'équipe. */
  readonly onEvent = this.#onEvent.event;
  readonly #onFailure = new vscode.EventEmitter<FailureReason>();
  readonly onFailure = this.#onFailure.event;

  #state: ConnectionState = { status: "disconnected" };
  #socket: WebSocket | null = null;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #attempt = 0;
  /** Faux quand la personne a demandé la déconnexion : on ne se reconnecte pas. */
  #wanted = false;

  constructor(
    private readonly getUrl: () => string,
    private readonly getToken: () => string | undefined,
    private readonly machine: MachineInfo,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  connect(): void {
    this.#wanted = true;
    this.#attempt = 0;
    this.#open();
  }

  /** Envoie un message au serveur ; renvoie faux si la connexion n'est pas établie. */
  send(message: ClientMessage): boolean {
    if (this.#state.status !== "connected" || !this.#socket) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  disconnect(): void {
    this.#wanted = false;
    this.#teardown();
    this.#setState({ status: "disconnected" });
  }

  dispose(): void {
    this.disconnect();
    this.#onDidChangeState.dispose();
    this.#onEvent.dispose();
    this.#onFailure.dispose();
  }

  #open(): void {
    this.#teardown();
    const token = this.getToken();
    if (!token) {
      this.#wanted = false;
      this.#setState({ status: "disconnected" });
      return;
    }
    const url = this.getUrl();
    this.#setState({ status: "connecting", attempt: this.#attempt });
    this.log.info(`Connexion à ${url} (tentative ${this.#attempt + 1})`);

    const socket = new WebSocket(url);
    this.#socket = socket;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, token, machine: this.machine }),
      );
    });
    socket.on("message", (data) => {
      const message = parseServerMessage(data.toString());
      if (!message) {
        this.log.warn("Message illisible reçu du serveur.");
        return;
      }
      this.#handle(message);
    });
    socket.on("error", (error) => {
      this.log.warn(`Erreur de connexion : ${error.message}`);
    });
    socket.on("close", (code) => {
      if (socket !== this.#socket) return;
      this.log.info(`Connexion fermée (code ${code}).`);
      this.#socket = null;
      clearInterval(this.#heartbeatTimer);
      if (this.#state.status === "failed" || !this.#wanted) return;
      this.#scheduleReconnect();
    });
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.#attempt = 0;
        this.log.info(`Connecté (serveur ${message.serverVersion}, connexion ${message.connectionId}).`);
        this.#setState({ status: "connected", serverVersion: message.serverVersion });
        this.#heartbeatTimer = setInterval(() => {
          this.#socket?.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
        }, HEARTBEAT_MS);
        return;
      case "pong":
        return;
      case "message.created":
      case "presence.changed":
      case "memory.changed":
      case "workspace.changed":
      case "preference.noted":
      case "platform.status":
      case "tool.call":
      case "order.updated":
        this.#onEvent.fire(message);
        return;
      case "error":
        this.log.error(`Le serveur a refusé la connexion : ${message.code} — ${message.message}`);
        if (message.code === "protocol_mismatch" || message.code === "unauthenticated") {
          this.#wanted = false;
          this.#setState({ status: "failed", message: message.message });
          this.#onFailure.fire(message.code);
        }
        return;
    }
  }

  #scheduleReconnect(): void {
    const delay = reconnectDelay(this.#attempt);
    this.#attempt += 1;
    this.#setState({ status: "connecting", attempt: this.#attempt });
    this.log.info(`Nouvelle tentative dans ${Math.round(delay / 1000)} s.`);
    this.#reconnectTimer = setTimeout(() => this.#open(), delay);
  }

  #teardown(): void {
    clearTimeout(this.#reconnectTimer);
    clearInterval(this.#heartbeatTimer);
    const socket = this.#socket;
    this.#socket = null;
    socket?.removeAllListeners();
    socket?.on("error", () => {});
    socket?.terminate();
  }

  #setState(state: ConnectionState): void {
    this.#state = state;
    this.#onDidChangeState.fire(state);
  }
}
