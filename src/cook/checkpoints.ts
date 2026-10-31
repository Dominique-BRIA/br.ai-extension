import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface Entry {
  /** Chemin absolu du fichier. */
  path: string;
  /** Contenu avant la première modification de la commande ; `null` si le fichier n'existait pas. */
  before: string | null;
}

/**
 * Points de restauration : avant la première modification d'un fichier par une commande,
 * son contenu d'origine est gardé, pour pouvoir annuler toutes les modifications de la commande.
 */
export class Checkpoints {
  constructor(private readonly folder: string) {}

  /** À appeler juste avant d'écrire un fichier. */
  async remember(orderId: string, path: string, before: string | null): Promise<void> {
    const entries = await this.#read(orderId);
    if (entries.some((entry) => entry.path === path)) return;
    entries.push({ path, before });
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.#file(orderId), JSON.stringify(entries));
  }

  async has(orderId: string): Promise<boolean> {
    return (await this.#read(orderId)).length > 0;
  }

  /** Remet chaque fichier dans son état d'avant la commande ; renvoie les chemins restaurés. */
  async revert(orderId: string): Promise<string[]> {
    const entries = await this.#read(orderId);
    for (const entry of [...entries].reverse()) {
      if (entry.before === null) {
        await rm(entry.path, { force: true });
      } else {
        await mkdir(dirname(entry.path), { recursive: true });
        await writeFile(entry.path, entry.before);
      }
    }
    await rm(this.#file(orderId), { force: true });
    return entries.map((entry) => entry.path);
  }

  async #read(orderId: string): Promise<Entry[]> {
    try {
      return JSON.parse(await readFile(this.#file(orderId), "utf8")) as Entry[];
    } catch {
      return [];
    }
  }

  #file(orderId: string): string {
    return join(this.folder, `${orderId}.json`);
  }
}
