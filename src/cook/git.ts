import { execFile } from "node:child_process";
import type { GitSaveResult } from "@br-ia/protocol";
import * as vscode from "vscode";

export type PushMode = "ask" | "auto";

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
  missing: boolean;
}

/**
 * Lance git dans le dossier du projet, sans passer par un interpréteur de commandes. Git ne
 * demande jamais de mot de passe dans un terminal : l'identification passe par le gestionnaire
 * d'identifiants de la machine, celui que le membre utilise déjà.
 */
export function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          code: failure ? (typeof failure.code === "number" ? failure.code : 1) : 0,
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
          missing: failure?.code === "ENOENT",
        });
      },
    );
  });
}

/** Résultat d'une étape Git, pour le cuisinier. */
export interface GitOutcome {
  ok: boolean;
  output: string;
}

const firstLines = (text: string) => text.split("\n").slice(0, 3).join(" ").slice(0, 400);

const failed = (step: string, run: GitRun): GitOutcome => ({
  ok: false,
  output: run.missing
    ? "Git n'est pas installé sur cette machine, ou pas dans le PATH."
    : `${step} : ${firstLines(run.stderr || run.stdout) || `code ${run.code}`}`,
});

/**
 * Place la machine sur la branche de la commande. Une branche déjà présente sur la machine
 * ou sur GitHub est reprise telle quelle ; sinon elle est créée depuis la branche principale à
 * jour. Le travail non enregistré du membre n'est jamais touché : la commande s'arrête plutôt.
 */
export async function prepareBranch(root: string, branch: string, base: string): Promise<GitOutcome> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.missing || inside.stdout !== "true") {
    return inside.missing
      ? failed("Git", inside)
      : {
          ok: false,
          output:
            "Le dossier du projet n'est pas un dépôt Git : clonez le dépôt du projet, puis associez ce dossier.",
        };
  }
  const status = await git(root, ["status", "--porcelain"]);
  if (status.code !== 0) return failed("Lecture de l'état du dépôt", status);
  if (status.stdout) {
    return {
      ok: false,
      output:
        "Le dossier contient des changements non enregistrés. Enregistrez-les (commit) ou mettez-les de côté (stash), puis relancez la commande.",
    };
  }
  const fetch = await git(root, ["fetch", "origin", "--prune"], 180_000);
  if (fetch.code !== 0) return failed("Récupération depuis GitHub impossible", fetch);

  const local = await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (local.code === 0) {
    const checkout = await git(root, ["checkout", branch]);
    if (checkout.code !== 0) return failed(`Passage sur ${branch} impossible`, checkout);
    return { ok: true, output: `Branche ${branch} reprise sur cette machine.` };
  }
  const remote = await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  if (remote.code === 0) {
    const checkout = await git(root, ["checkout", "-b", branch, "--track", `origin/${branch}`]);
    if (checkout.code !== 0) return failed(`Reprise de ${branch} impossible`, checkout);
    return { ok: true, output: `Branche ${branch} reprise depuis GitHub.` };
  }
  const start = await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]);
  if (start.code !== 0) {
    return {
      ok: false,
      output: `La branche principale « ${base} » est introuvable sur GitHub (origin/${base}).`,
    };
  }
  const create = await git(root, ["checkout", "--no-track", "-b", branch, `origin/${base}`]);
  if (create.code !== 0) return failed(`Création de ${branch} impossible`, create);
  return { ok: true, output: `Branche ${branch} créée depuis ${base}.` };
}

/**
 * Enregistre le travail du cuisinier dans un commit, au nom du membre (son identité Git, sans
 * mention de l'IA), puis pousse la branche : tout de suite, ou après son accord selon le réglage
 * « bria.pushMode ».
 */
export async function saveBranch(root: string, branch: string, message: string): Promise<GitOutcome> {
  const current = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.code !== 0) return failed("Lecture de la branche", current);
  if (current.stdout !== branch) {
    return {
      ok: false,
      output: `La machine n'est plus sur ${branch} (branche actuelle : ${current.stdout}).`,
    };
  }
  const name = await git(root, ["config", "user.name"]);
  const email = await git(root, ["config", "user.email"]);
  if (!name.stdout || !email.stdout) {
    return {
      ok: false,
      output:
        'Git ne connaît pas votre nom : lancez git config --global user.name "Votre nom" et git config --global user.email "vous@exemple.org".',
    };
  }

  const add = await git(root, ["add", "--all"]);
  if (add.code !== 0) return failed("Préparation du commit", add);
  const staged = await git(root, ["diff", "--cached", "--quiet"]);
  if (staged.code === 0)
    return result({ commit: null, pushed: false, note: "Aucun changement à enregistrer dans Git." });

  const commit = await git(root, ["commit", "-m", message], 180_000);
  if (commit.code !== 0) return failed("Commit refusé", commit);
  const sha = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout;

  const mode = vscode.workspace.getConfiguration("bria").get<PushMode>("pushMode", "ask");
  if (mode === "ask") {
    const push = vscode.l10n.t("Push");
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t("The cook saved its work in commit {0} on {1}. Push this branch to GitHub?", sha, branch),
      push,
      vscode.l10n.t("Later"),
    );
    if (answer !== push) {
      return result({
        commit: sha,
        pushed: false,
        note: `Travail enregistré dans le commit ${sha} sur la branche \`${branch}\`, pas encore poussé sur GitHub.`,
      });
    }
  }
  const pushed = await git(root, ["push", "--set-upstream", "origin", branch], 300_000);
  if (pushed.code !== 0) {
    const why = failed("", pushed).output.replace(/^ : /, "");
    return result({
      commit: sha,
      pushed: false,
      note: `Travail enregistré dans le commit ${sha} sur la branche \`${branch}\`, mais le push a échoué : ${why}`,
    });
  }
  return result({
    commit: sha,
    pushed: true,
    note: `Travail enregistré dans le commit ${sha} et poussé sur GitHub, branche \`${branch}\`.`,
  });
}

function result(value: GitSaveResult): GitOutcome {
  return { ok: true, output: JSON.stringify(value) };
}
