import type { MemoryItem, MemoryResponse } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "./api";
import type { Connection } from "./connection";

/** La mémoire du projet ouvert, rechargée quand le serveur signale un changement. */
export class MemoryStore implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #subscriptions: vscode.Disposable[];
  #projectId: string | undefined;
  #items: MemoryItem[] = [];

  constructor(
    private readonly api: Api,
    connection: Connection,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.#subscriptions = [
      connection.onEvent((event) => {
        if (event.type === "memory.changed" && event.projectId === this.#projectId) void this.refresh();
      }),
      connection.onDidChangeState((state) => {
        if (state.status === "connected") void this.refresh();
      }),
    ];
  }

  get projectId(): string | undefined {
    return this.#projectId;
  }

  get items(): MemoryItem[] {
    return this.#items;
  }

  async setProject(projectId: string | undefined): Promise<void> {
    this.#projectId = projectId;
    this.#items = [];
    this.#publish();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId) return;
    try {
      const { items } = await this.api.get<MemoryResponse>(`/projects/${projectId}/memory`);
      if (projectId !== this.#projectId) return;
      this.#items = items;
      this.#publish();
    } catch (error) {
      this.log.warn(`Chargement de la mémoire impossible : ${(error as Error).message}`);
    }
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChange.dispose();
  }

  #publish(): void {
    void vscode.commands.executeCommand("setContext", "bria.projectOpen", Boolean(this.#projectId));
    void vscode.commands.executeCommand("setContext", "bria.memoryEmpty", this.#items.length === 0);
    this.#onDidChange.fire();
  }
}
