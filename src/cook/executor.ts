import { exec, spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { cookTools, gitTools, isCookTool, isGitTool } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Connection } from "../connection";
import type { Checkpoints } from "./checkpoints";
import { ensureGitignored, envValues, maskSecrets, mergeEnv, type SecretValue } from "./envFile";
import { prepareBranch, saveBranch } from "./git";
import type { ProjectFolders } from "./projectFolders";
import type { ProposalReview } from "./proposals";
import { dangerousCommand, IGNORED_DIRECTORIES, resolveInProject } from "./safety";
import type { CookTerminal } from "./terminal";

export type PermissionMode = "manual" | "autoEdit" | "auto" | "plan";

const MAX_READ_BYTES = 300_000;
const MAX_OUTPUT = 60_000;

/** Ce que l'exécuteur renvoie au cuisinier. */
interface Outcome {
  ok: boolean;
  output: string;
}

const refused = (why: string): Outcome => ({ ok: false, output: why });

/**
 * Exécute sur cette machine les outils demandés par le cuisinier, dans le dossier
 * associé au projet, en respectant le mode de permission choisi par le membre.
 */
export class CookExecutor implements vscode.Disposable {
  readonly #onDidChangeBusy = new vscode.EventEmitter<string | undefined>();
  /** Commande en cours sur cette machine (ou `undefined`). */
  readonly onDidChangeBusy = this.#onDidChangeBusy.event;
  readonly #subscription: vscode.Disposable;
  #busyOrder: string | undefined;
  /** Valeurs récupérées du coffre pour chaque projet, à masquer dans les sorties. */
  readonly #secretValues = new Map<string, string[]>();
  #idle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    connection: Connection,
    private readonly folders: ProjectFolders,
    private readonly proposals: ProposalReview,
    private readonly checkpoints: Checkpoints,
    private readonly terminal: CookTerminal,
    private readonly log: vscode.LogOutputChannel,
    private readonly describeOrder: (orderId: string) => string,
    /** Les secrets du coffre ouverts au propriétaire de la machine, pour un projet. */
    private readonly fetchSecrets: (projectId: string) => Promise<SecretValue[]>,
  ) {
    this.#subscription = connection.onEvent(async (event) => {
      if (event.type !== "tool.call") return;
      this.#setBusy(event.orderId);
      let outcome: Outcome;
      try {
        outcome = await this.#run(event.orderId, event.projectId, event.tool, event.input);
      } catch (error) {
        outcome = { ok: false, output: `Erreur : ${(error as Error).message}` };
      }
      // L'IA ne voit jamais une valeur secrète : ni du coffre, ni du .env de la machine.
      outcome = { ...outcome, output: await this.#mask(event.projectId, outcome.output) };
      this.log.info(`Cuisinier : ${event.tool} → ${outcome.ok ? "fait" : "refusé ou en échec"}`);
      if (event.tool !== "run_command") this.terminal.step(describe(event.tool, event.input, outcome));
      connection.send({
        type: "tool.result",
        callId: event.callId,
        ok: outcome.ok,
        output: outcome.output.slice(0, 190_000),
      });
    });
  }

  get busyOrder(): string | undefined {
    return this.#busyOrder;
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#onDidChangeBusy.dispose();
    clearTimeout(this.#idle);
  }

  /** La machine est « au travail » tant que des outils arrivent ; elle redevient libre après un moment de calme. */
  #setBusy(orderId: string): void {
    clearTimeout(this.#idle);
    if (this.#busyOrder !== orderId) {
      this.#busyOrder = orderId;
      this.#onDidChangeBusy.fire(orderId);
    }
    this.#idle = setTimeout(() => {
      this.#busyOrder = undefined;
      this.#onDidChangeBusy.fire(undefined);
    }, 90_000);
  }

  /** À appeler quand la commande se termine, pour libérer tout de suite l'indicateur. */
  orderFinished(orderId: string): void {
    if (this.#busyOrder !== orderId) return;
    clearTimeout(this.#idle);
    this.#busyOrder = undefined;
    this.#onDidChangeBusy.fire(undefined);
    this.proposals.rejectAll();
  }

  async #run(orderId: string, projectId: string, tool: string, rawInput: unknown): Promise<Outcome> {
    const root = this.folders.get(projectId);
    if (!root) return refused("Aucun dossier n'est associé à ce projet sur cette machine.");
    if (isGitTool(tool)) return this.#git(root, tool, rawInput);
    if (!isCookTool(tool)) return refused(`Outil inconnu : ${tool}.`);
    const parsed = cookTools[tool].input.safeParse(rawInput);
    if (!parsed.success) return refused(`Paramètres invalides : ${parsed.error.message}`);
    const input = parsed.data as Record<string, unknown>;
    const mode = vscode.workspace.getConfiguration("bria").get<PermissionMode>("permissionMode", "manual");

    switch (tool) {
      case "read_file":
        return this.#readFile(root, String(input.path));
      case "list_dir":
        return this.#listDir(root, String(input.path));
      case "search":
        return this.#search(root, String(input.query), String(input.path));
      case "write_file":
      case "edit_file":
        return this.#write(orderId, root, mode, tool, input);
      case "run_command":
        return this.#command(root, mode, String(input.command), Number(input.timeout_seconds));
      case "check_environment":
        return this.#environment();
      case "write_env":
        return this.#writeEnv(orderId, projectId, root, mode, String(input.path));
    }
  }

  /**
   * Branche et commit de la commande, demandés par le serveur autour du travail de l'IA. En
   * mode Plan, rien n'est écrit : la branche n'est pas créée et rien n'est enregistré.
   */
  async #git(root: string, tool: keyof typeof gitTools, rawInput: unknown): Promise<Outcome> {
    const parsed = gitTools[tool].input.safeParse(rawInput);
    if (!parsed.success) return refused(`Paramètres invalides : ${parsed.error.message}`);
    const mode = vscode.workspace.getConfiguration("bria").get<PermissionMode>("permissionMode", "manual");
    if (tool === "git_prepare") {
      const { branch, base } = parsed.data as { branch: string; base: string };
      if (mode === "plan") return { ok: true, output: "Mode Plan : la branche n'est pas créée." };
      return prepareBranch(root, branch, base);
    }
    const { branch, message } = parsed.data as { branch: string; message: string };
    if (mode === "plan") {
      return {
        ok: true,
        output: JSON.stringify({
          commit: null,
          pushed: false,
          note: "Mode Plan : rien n'est enregistré dans Git.",
        }),
      };
    }
    return saveBranch(root, branch, message);
  }

  /** Chemin dans le projet ; un chemin extérieur exige l'accord explicite du membre. */
  async #path(root: string, path: string, action: string): Promise<string | null> {
    const { absolute, inside } = resolveInProject(root, path);
    if (inside) return absolute;
    const allow = vscode.l10n.t("Allow");
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t("The cook wants to {0} outside the project folder: {1}", action, absolute),
      { modal: true },
      allow,
    );
    return answer === allow ? absolute : null;
  }

  async #readFile(root: string, path: string): Promise<Outcome> {
    const absolute = await this.#path(root, path, vscode.l10n.t("read a file"));
    if (!absolute) return refused("Accès refusé par le membre (hors du dossier du projet).");
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) return refused(`Fichier introuvable : ${path}`);
    if (info.size > MAX_READ_BYTES) return refused(`Fichier trop volumineux (${info.size} octets).`);
    const content = await readFile(absolute);
    if (content.includes(0)) return refused("Fichier binaire : il ne peut pas être lu comme du texte.");
    return { ok: true, output: content.toString("utf8") };
  }

  async #listDir(root: string, path: string): Promise<Outcome> {
    const absolute = await this.#path(root, path, vscode.l10n.t("list a folder"));
    if (!absolute) return refused("Accès refusé par le membre (hors du dossier du projet).");
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
    if (!entries) return refused(`Dossier introuvable : ${path}`);
    const lines = entries
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 300)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return { ok: true, output: lines.length > 0 ? lines.join("\n") : "(dossier vide)" };
  }

  async #search(root: string, query: string, path: string): Promise<Outcome> {
    const start = await this.#path(root, path, vscode.l10n.t("search"));
    if (!start) return refused("Accès refusé par le membre (hors du dossier du projet).");
    const results: string[] = [];
    let visited = 0;
    const walk = async (folder: string): Promise<void> => {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (results.length >= 50 || visited > 3000) return;
        const full = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(full);
          continue;
        }
        visited++;
        const info = await stat(full).catch(() => null);
        if (!info || info.size > 1_000_000) continue;
        const content = await readFile(full).catch(() => null);
        if (!content || content.includes(0)) continue;
        content
          .toString("utf8")
          .split(/\r?\n/)
          .forEach((line, index) => {
            if (results.length < 50 && line.includes(query)) {
              results.push(`${relative(root, full)}:${index + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
      }
    };
    await walk(start);
    return { ok: true, output: results.length > 0 ? results.join("\n") : "Aucun résultat." };
  }

  async #write(
    orderId: string,
    root: string,
    mode: PermissionMode,
    tool: "write_file" | "edit_file",
    input: Record<string, unknown>,
  ): Promise<Outcome> {
    const path = String(input.path);
    if (mode === "plan") {
      return refused(
        "Mode Plan : le membre ne veut pas de modification. Décris ce que tu ferais, sans modifier.",
      );
    }
    // Hors du projet, on n'écrit que dans un dossier qui existe déjà : un chemin inventé
    // (un autre nom d'utilisateur, par exemple) ne doit pas créer de dossiers sur la machine.
    const target = resolveInProject(root, path);
    if (!target.inside && !(await stat(dirname(target.absolute)).catch(() => null))?.isDirectory()) {
      return refused(
        `Le dossier ${dirname(target.absolute)} n'existe pas sur cette machine. N'invente pas de chemin : pars des dossiers de la machine indiqués dans la commande, ou vérifie avec list_dir.`,
      );
    }
    const absolute = await this.#path(root, path, vscode.l10n.t("write a file"));
    if (!absolute) return refused("Écriture refusée par le membre (hors du dossier du projet).");

    const before = await readFile(absolute, "utf8").catch(() => null);
    let after: string;
    if (tool === "write_file") {
      after = String(input.content);
    } else {
      if (before === null) return refused(`Fichier introuvable : ${path}`);
      const oldText = String(input.old_text);
      const count = before.split(oldText).length - 1;
      if (count === 0) return refused("Le passage à remplacer est introuvable. Relis le fichier.");
      if (count > 1)
        return refused(`Le passage à remplacer apparaît ${count} fois : donne un passage plus long.`);
      after = before.replace(oldText, () => String(input.new_text));
    }
    if (after === before) return { ok: true, output: "Aucun changement : le contenu est identique." };

    if (mode === "manual") {
      const accepted = await this.proposals.review({
        id: `${orderId}-${Date.now()}`,
        title: vscode.l10n.t("{0}: {1} (proposed by the cook)", this.describeOrder(orderId), path),
        file: vscode.Uri.file(absolute),
        exists: before !== null,
        proposed: after,
      });
      if (!accepted) return refused("Modification refusée par le membre.");
    }

    await this.checkpoints.remember(orderId, absolute, before);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, after);
    return { ok: true, output: before === null ? `Fichier créé : ${path}` : `Fichier modifié : ${path}` };
  }

  async #command(
    root: string,
    mode: PermissionMode,
    command: string,
    timeoutSeconds: number,
  ): Promise<Outcome> {
    if (mode === "plan") return refused("Mode Plan : aucune commande n'est lancée.");
    const danger = dangerousCommand(command);
    if (mode !== "auto" || danger) {
      const run = vscode.l10n.t("Run");
      const answer = await vscode.window.showWarningMessage(
        danger
          ? vscode.l10n.t("The cook wants to run a risky command ({0}):", danger)
          : vscode.l10n.t("The cook wants to run a command:"),
        { modal: true, detail: `${command}\n\n${vscode.l10n.t("Folder: {0}", root)}` },
        run,
      );
      if (answer !== run) return refused("Commande refusée par le membre.");
    }
    if (vscode.workspace.getConfiguration("bria").get<boolean>("showCookTerminal", true))
      this.terminal.show();
    this.terminal.commandStarted(command, root);
    const outcome = await runShell(command, root, timeoutSeconds * 1000, (chunk) =>
      this.terminal.output(chunk),
    );
    this.terminal.commandEnded(outcome.code);
    return outcome;
  }

  /**
   * Écrit le .env du projet avec les secrets du coffre ouverts au propriétaire de la machine,
   * et l'ajoute au .gitignore. L'IA ne reçoit que les noms.
   */
  async #writeEnv(
    orderId: string,
    projectId: string,
    root: string,
    mode: PermissionMode,
    path: string,
  ): Promise<Outcome> {
    if (mode === "plan") return refused("Mode Plan : aucun fichier n'est écrit.");
    const target = resolveInProject(root, path);
    if (!target.inside) return refused("Le .env doit rester dans le dossier du projet.");
    const secrets = await this.fetchSecrets(projectId);
    if (secrets.length === 0) {
      return refused("Aucun secret du coffre n'est ouvert au propriétaire de cette machine pour ce projet.");
    }
    const names = secrets.map((secret) => secret.name).join(", ");
    if (mode !== "auto") {
      const write = vscode.l10n.t("Write");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("The cook wants to write {0} with these secrets from the vault: {1}", path, names),
        { modal: true, detail: vscode.l10n.t("The values stay on this machine: the AI never sees them.") },
        write,
      );
      if (answer !== write) return refused("Écriture du .env refusée par le membre.");
    }
    this.#secretValues.set(
      projectId,
      secrets.map((secret) => secret.value),
    );
    const before = await readFile(target.absolute, "utf8").catch(() => null);
    await this.checkpoints.remember(orderId, target.absolute, before);
    await mkdir(dirname(target.absolute), { recursive: true });
    await writeFile(target.absolute, mergeEnv(before ?? "", secrets));
    const ignored = await ensureGitignored(root, relative(root, target.absolute));
    return {
      ok: true,
      output: `Fichier ${path} écrit avec : ${names}.${ignored ? " Ajouté au .gitignore." : " Déjà dans le .gitignore."}`,
    };
  }

  /** Masque les valeurs du coffre et celles du .env du projet. */
  async #mask(projectId: string, text: string): Promise<string> {
    const root = this.folders.get(projectId);
    const local = root ? await readFile(join(root, ".env"), "utf8").catch(() => "") : "";
    return maskSecrets(text, [...(this.#secretValues.get(projectId) ?? []), ...envValues(local)]);
  }

  async #environment(): Promise<Outcome> {
    const version = (command: string) =>
      new Promise<string>((resolve) =>
        exec(command, { timeout: 5_000 }, (error, stdout, stderr) =>
          resolve(error ? "absent" : ((stdout || stderr).trim().split(/\r?\n/)[0] ?? "")),
        ),
      );
    const [node, npm, python, git] = await Promise.all([
      version("node --version"),
      version("npm --version"),
      version(process.platform === "win32" ? "python --version" : "python3 --version"),
      version("git --version"),
    ]);
    return {
      ok: true,
      output: [
        `Système : ${process.platform} (${process.arch})`,
        `Interpréteur de commandes : ${process.platform === "win32" ? "cmd.exe" : "/bin/sh"}`,
        `Node : ${node}`,
        `npm : ${npm}`,
        `Python : ${python}`,
        `Git : ${git}`,
      ].join("\n"),
    };
  }
}

/** Une ligne lisible pour le terminal du cuisinier. */
function describe(tool: string, input: Record<string, unknown>, outcome: Outcome): string {
  const path = typeof input.path === "string" ? input.path : "";
  const failed = outcome.ok ? "" : ` — ${outcome.output.split("\n")[0]}`;
  switch (tool) {
    case "read_file":
      return `${vscode.l10n.t("Read")} ${path}${failed}`;
    case "list_dir":
      return `${vscode.l10n.t("Listed")} ${path || "."}${failed}`;
    case "search":
      return `${vscode.l10n.t("Searched")} « ${String(input.query)} »${failed}`;
    case "write_file":
    case "edit_file":
      return outcome.ok
        ? `${vscode.l10n.t("Changed")} ${path}`
        : `${vscode.l10n.t("Not changed")} ${path}${failed}`;
    case "write_env":
      return outcome.ok
        ? `${vscode.l10n.t("Wrote {0} from the vault", path)}`
        : `${vscode.l10n.t("Not changed")} ${path}${failed}`;
    case "git_prepare":
      return outcome.ok ? outcome.output : `${vscode.l10n.t("Branch not ready")}${failed}`;
    case "git_save": {
      if (!outcome.ok) return `${vscode.l10n.t("Work not saved in Git")}${failed}`;
      try {
        return String(JSON.parse(outcome.output).note);
      } catch {
        return outcome.output;
      }
    }
    default:
      return `${tool}${failed}`;
  }
}

/** Lance une commande et renvoie sa sortie (standard et erreurs) et son code de sortie. */
function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  onOutput: (chunk: string) => void,
): Promise<Outcome & { code: number | null }> {
  return new Promise((resolve) => {
    let output = "";
    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      onOutput(text);
      output += text;
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
    const timer = setTimeout(() => {
      child.kill();
      output += `\n[Arrêtée après ${Math.round(timeoutMs / 1000)} s.]`;
    }, timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: `Impossible de lancer la commande : ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = output.length > MAX_OUTPUT ? `[…]\n${output.slice(-MAX_OUTPUT)}` : output;
      resolve({
        ok: code === 0,
        code,
        output: `Code de sortie : ${code}\n${tail.trim() || "(aucune sortie)"}`,
      });
    });
  });
}
