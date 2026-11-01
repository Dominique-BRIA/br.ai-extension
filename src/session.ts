import type { User } from "@br-ia/protocol";
import * as vscode from "vscode";

const TOKEN_KEY = "bria.sessionToken";
const USER_KEY = "bria.user";

/**
 * La session du membre sur cette machine. Le jeton est rangé dans le coffre
 * de VS Code (SecretStorage), jamais dans les réglages.
 */
export class Session implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<User | undefined>();
  readonly onDidChange = this.#onDidChange.event;
  #token: string | undefined;
  #user: User | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async restore(): Promise<void> {
    this.#token = await this.context.secrets.get(TOKEN_KEY);
    this.#user = this.#token ? this.context.globalState.get<User>(USER_KEY) : undefined;
    void this.#publish();
  }

  get token(): string | undefined {
    return this.#token;
  }

  get user(): User | undefined {
    return this.#user;
  }

  async signedIn(token: string, user: User): Promise<void> {
    this.#token = token;
    this.#user = user;
    await this.context.secrets.store(TOKEN_KEY, token);
    await this.context.globalState.update(USER_KEY, user);
    await this.#publish();
  }

  async clear(): Promise<void> {
    if (!this.#token) return;
    this.#token = undefined;
    this.#user = undefined;
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.globalState.update(USER_KEY, undefined);
    await this.#publish();
  }

  dispose(): void {
    this.#onDidChange.dispose();
  }

  async #publish(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "bria.signedIn", Boolean(this.#token));
    this.#onDidChange.fire(this.#user);
  }
}
