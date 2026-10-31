import { PROTOCOL_VERSION } from "@br-ia/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

// Le module vscode n'existe que dans l'éditeur : on remplace ce dont Connection a besoin.
vi.mock("vscode", () => {
  class EventEmitter<T> {
    #listeners: ((value: T) => void)[] = [];
    event = (listener: (value: T) => void) => {
      this.#listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(value: T) {
      for (const listener of this.#listeners) listener(value);
    }
    dispose() {}
  }
  return { EventEmitter };
});

const { Connection } = await import("../src/connection");
type State = InstanceType<typeof Connection>["state"];

const log = { info() {}, warn() {}, error() {} } as never;
const machine = {
  id: "machine-test",
  os: "windows",
  editor: "Visual Studio Code",
  editorVersion: "1.95.0",
  extensionVersion: "0.1.0",
} as const;

let server: WebSocketServer | undefined;
let connection: InstanceType<typeof Connection> | undefined;

afterEach(() => {
  connection?.dispose();
  server?.close();
});

/** Démarre un faux serveur qui répond au premier message par `reply`. */
async function fakeServer(reply: (hello: unknown) => object) {
  const received: unknown[] = [];
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
  server.on("connection", (socket) => {
    socket.once("message", (data) => {
      const hello = JSON.parse(data.toString());
      received.push(hello);
      socket.send(JSON.stringify(reply(hello)));
    });
  });
  const { port } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}/ws`, received };
}

function waitFor(status: State["status"]) {
  return new Promise<State>((resolve) => {
    const subscription = connection?.onDidChangeState((state) => {
      if (state.status === status) {
        subscription?.dispose();
        resolve(state);
      }
    });
  });
}

describe("Connection", () => {
  it("se présente au serveur et passe à l'état connecté", async () => {
    const { url, received } = await fakeServer(() => ({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: "0.1.0",
      connectionId: "c1",
    }));
    connection = new Connection(
      () => url,
      () => "jeton",
      machine,
      log,
    );
    const connected = waitFor("connected");
    connection.connect();

    expect(await connected).toEqual({ status: "connected", serverVersion: "0.1.0" });
    expect(received[0]).toEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      token: "jeton",
      machine,
    });
  });

  it("s'arrête sans réessayer quand le serveur refuse la version du protocole", async () => {
    const { url } = await fakeServer(() => ({
      type: "error",
      code: "protocol_mismatch",
      message: "Mettez l'extension à jour.",
    }));
    connection = new Connection(
      () => url,
      () => "jeton",
      machine,
      log,
    );
    const failed = waitFor("failed");
    connection.connect();

    expect(await failed).toEqual({ status: "failed", message: "Mettez l'extension à jour." });
  });

  it("revient à l'état déconnecté quand on se déconnecte", async () => {
    connection = new Connection(
      () => "ws://127.0.0.1:9/ws",
      () => "jeton",
      machine,
      log,
    );
    connection.connect();
    connection.disconnect();
    expect(connection.state).toEqual({ status: "disconnected" });
  });
});
