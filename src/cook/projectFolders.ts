import { basename } from "node:path";
import * as vscode from "vscode";
import type { Connection } from "../connection";

const KEY = "bria.projectFolders";

/**
 * Le dossier local associé à chaque projet, propre à cette machine. Le cuisinier ne
 * travaille que dans ces dossiers. L'état est annoncé au serveur (avec le prêt de machine).
 */
export class ProjectFolders implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #subscriptions: vscode.Disposable[];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connection: Connection,
  ) {
    this.#subscriptions = [
      connection.onDidChangeState((state) => {
        if (state.status === "connected") this.announce();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("bria.lendMachine")) this.announce();
      }),
    ];
  }

  get(projectId: string): string | undefined {
    return this.#all()[projectId];
  }

  label(projectId: string): string | undefined {
    const folder = this.get(projectId);
    return folder ? basename(folder) : undefined;
  }

  async set(projectId: string, folder: string | undefined): Promise<void> {
    const all = this.#all();
    if (folder) all[projectId] = folder;
    else delete all[projectId];
    await this.context.globalState.update(KEY, all);
    this.#onDidChange.fire();
    this.announce();
  }

  /** Dit au serveur pour quels projets cette machine peut accueillir le cuisinier. */
  announce(): void {
    this.connection.send({
      type: "machine.status",
      projects: Object.keys(this.#all()),
      lending: vscode.workspace.getConfiguration("bria").get<boolean>("lendMachine", false),
    });
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChange.dispose();
  }

  #all(): Record<string, string> {
    return { ...this.context.globalState.get<Record<string, string>>(KEY, {}) };
  }
}
