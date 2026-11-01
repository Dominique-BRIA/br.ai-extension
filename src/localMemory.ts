import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalMemory as Backup } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "./api";
import type { Connection } from "./connection";
import type { Session } from "./session";

const HEADER =
  "# Ma mémoire \\<br\\>.ia\n\nPréférences de travail que le cuisinier respecte sur cette machine. Vous pouvez modifier ce fichier.\n\n";

/**
 * La mémoire locale de la machine, `~/.bria/memoire.md` : les préférences de travail que le
 * serveur a relevées dans le chat. Le membre peut la modifier ; chaque changement est
 * sauvegardé sur le serveur, qui la restaure sur une nouvelle machine.
 */
export class LocalMemory implements vscode.Disposable {
  static readonly file = join(homedir(), ".bria", "memoire.md");
  readonly #subscriptions: vscode.Disposable[];
  #upload: NodeJS.Timeout | undefined;
  /** Dernier contenu connu du serveur, pour ne pas renvoyer ce qu'il a déjà. */
  #synced: string | undefined;

  constructor(
    private readonly api: Api,
    connection: Connection,
    private readonly session: Session,
    private readonly log: vscode.LogOutputChannel,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(join(homedir(), ".bria")), "memoire.md"),
    );
    this.#subscriptions = [
      watcher,
      watcher.onDidChange(() => this.#scheduleUpload()),
      watcher.onDidCreate(() => this.#scheduleUpload()),
      connection.onEvent((event) => {
        if (event.type === "preference.noted") void this.#note(event.text);
      }),
      connection.onDidChangeState((state) => {
        if (state.status === "connected") void this.sync();
      }),
    ];
  }

  /** Ouvre le fichier dans l'éditeur (en le créant au besoin). */
  async open(): Promise<void> {
    if ((await this.#read()) === null) await this.#write(HEADER);
    await vscode.window.showTextDocument(vscode.Uri.file(LocalMemory.file));
  }

  /**
   * Aligne la machine et le serveur : une machine sans mémoire reprend la sauvegarde ;
   * sinon c'est la mémoire de la machine qui est sauvegardée.
   */
  async sync(): Promise<void> {
    if (!this.session.token) return;
    try {
      const local = await this.#read();
      const backup = await this.api.get<Backup>("/me/local-memory");
      this.#synced = backup.content;
      if (local === null || local.trim() === HEADER.trim()) {
        if (backup.content.trim()) {
          await this.#write(backup.content);
          this.log.info("Mémoire locale restaurée depuis la sauvegarde du serveur.");
        }
        return;
      }
      if (local !== backup.content) await this.#save(local);
    } catch (error) {
      this.log.warn(`Synchronisation de la mémoire locale impossible : ${(error as Error).message}`);
    }
  }

  dispose(): void {
    clearTimeout(this.#upload);
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  /** Ajoute une préférence relevée par le serveur, si elle n'y est pas déjà. */
  async #note(text: string): Promise<void> {
    const current = (await this.#read()) ?? HEADER;
    if (current.includes(text)) return;
    const date = new Date().toISOString().slice(0, 10);
    await this.#write(`${current.replace(/\s*$/, "\n")}- ${text} _(${date})_\n`);
    this.#scheduleUpload();
    const open = vscode.l10n.t("Open my memory");
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t("Preference saved on this machine: {0}", text),
      open,
    );
    if (choice === open) await this.open();
  }

  #scheduleUpload(): void {
    clearTimeout(this.#upload);
    this.#upload = setTimeout(async () => {
      const content = await this.#read();
      if (content !== null && content !== this.#synced) await this.#save(content);
    }, 1500);
  }

  async #save(content: string): Promise<void> {
    if (!this.session.token) return;
    try {
      await this.api.put<Backup>("/me/local-memory", { content: content.slice(0, 20_000) });
      this.#synced = content;
    } catch (error) {
      this.log.warn(`Sauvegarde de la mémoire locale impossible : ${(error as Error).message}`);
    }
  }

  async #read(): Promise<string | null> {
    return readFile(LocalMemory.file, "utf8").catch(() => null);
  }

  async #write(content: string): Promise<void> {
    await mkdir(join(homedir(), ".bria"), { recursive: true });
    await writeFile(LocalMemory.file, content);
  }
}
