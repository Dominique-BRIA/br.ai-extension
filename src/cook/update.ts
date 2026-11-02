import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { git } from "./git";

export type UpdateOutcome =
  /** Du travail non enregistré : le membre décide quoi en faire. */
  | { status: "dirty" }
  | { status: "failed"; message: string }
  /** Le membre travaille sur une autre branche : on ne l'en déloge pas. */
  | { status: "other-branch"; branch: string }
  | { status: "updated"; changedFiles: string[]; stashConflict: boolean };

const reason = (run: { stdout: string; stderr: string; code: number }) =>
  (run.stderr || run.stdout).split("\n")[0] || `code ${run.code}`;

/**
 * Met le dossier à jour sur la branche principale de GitHub, en avance rapide uniquement : le
 * travail du membre n'est jamais écrasé. Avec `stash`, ses changements non enregistrés sont mis de
 * côté puis réappliqués ; en cas de conflit, ils restent aussi dans la réserve de Git.
 */
export async function updateToLatest(root: string, base: string, stash = false): Promise<UpdateOutcome> {
  const fail = (message: string): UpdateOutcome => ({ status: "failed", message });
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.missing) return fail(vscode.l10n.t("Git is not installed on this machine."));
  if (inside.stdout !== "true") return fail(vscode.l10n.t("The project folder is not a Git repository."));

  const status = await git(root, ["status", "--porcelain"]);
  if (status.code !== 0) return fail(reason(status));
  const dirty = status.stdout !== "";
  if (dirty && !stash) return { status: "dirty" };

  const fetch = await git(root, ["fetch", "origin", "--prune"], 180_000);
  if (fetch.code !== 0) return fail(vscode.l10n.t("Could not reach GitHub: {0}", reason(fetch)));

  const current = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
  // Les branches bria/ sont celles des commandes : leur travail est déjà enregistré, on peut les quitter.
  if (current !== base && !current.startsWith("bria/")) {
    await git(root, ["fetch", "origin", `${base}:${base}`], 180_000);
    return { status: "other-branch", branch: current };
  }

  if (dirty) {
    const saved = await git(root, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "<br/> : avant la mise à jour",
    ]);
    if (saved.code !== 0) return fail(reason(saved));
  }
  const restore = async () => (dirty ? (await git(root, ["stash", "pop"])).code !== 0 : false);

  if (current !== base) {
    const checkout = await git(root, ["checkout", base]);
    if (checkout.code !== 0) {
      await restore();
      return fail(reason(checkout));
    }
  }
  const before = (await git(root, ["rev-parse", "HEAD"])).stdout;
  const merge = await git(root, ["merge", "--ff-only", `origin/${base}`]);
  if (merge.code !== 0) {
    await restore();
    return fail(vscode.l10n.t("{0} has local commits that are not on GitHub: {1}", base, reason(merge)));
  }
  const changed = await git(root, ["diff", "--name-only", before, "HEAD"]);
  return {
    status: "updated",
    changedFiles: changed.stdout ? changed.stdout.split("\n") : [],
    stashConflict: await restore(),
  };
}

export interface InstallCommand {
  /** Dossier relatif à la racine du projet ; "." pour la racine. */
  dir: string;
  command: string;
}

/** Fichier de verrouillage -> commande, et gestionnaire à utiliser pour un package.json. */
const LOCKFILES: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm install",
  "yarn.lock": "yarn install",
  "bun.lock": "bun install",
  "bun.lockb": "bun install",
  "package-lock.json": "npm install",
};
const OTHER_MANIFESTS: Record<string, string> = {
  "requirements.txt": "pip install -r requirements.txt",
  "poetry.lock": "poetry install",
  "uv.lock": "uv sync",
  "Pipfile.lock": "pipenv install",
  "composer.lock": "composer install",
  "Gemfile.lock": "bundle install",
};

/**
 * Les installations à relancer d'après les fichiers changés par la mise à jour. Un package.json
 * suit le fichier de verrouillage le plus proche : dans un monorepo, tout s'installe à sa racine.
 */
export function installCommands(root: string, changedFiles: string[]): InstallCommand[] {
  const found = new Map<string, InstallCommand>();
  const add = (dir: string, command: string) => found.set(`${dir}|${command}`, { dir, command });
  const lockIn = (dir: string) =>
    Object.keys(LOCKFILES).find((lockfile) => existsSync(join(root, dir, lockfile)));

  for (const file of changedFiles) {
    const dir = dirname(file).replace(/\\/g, "/");
    const name = file.slice(file.replace(/\\/g, "/").lastIndexOf("/") + 1);
    const lockCommand = LOCKFILES[name];
    const other = OTHER_MANIFESTS[name];
    if (lockCommand) add(dir, lockCommand);
    else if (other) add(dir, other);
    else if (name === "package.json") {
      let current = dir;
      while (!lockIn(current) && current !== ".") current = dirname(current);
      const lockfile = lockIn(current);
      if (lockfile) add(current, LOCKFILES[lockfile] as string);
      else add(dir, "npm install");
    }
  }
  return [...found.values()];
}
