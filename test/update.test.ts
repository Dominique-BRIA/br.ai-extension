import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: {
    t: (text: string, ...args: unknown[]) => text.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)])),
  },
}));

const { installCommands, updateToLatest } = await import("../src/cook/update");

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function identity(folder: string, name: string) {
  run(folder, "config", "user.name", name);
  run(folder, "config", "user.email", `${name}@exemple.org`);
}

/** Un « GitHub » local, le clone du membre, et un collègue dont on fusionne le travail sur main. */
function setup() {
  const base = mkdtempSync(join(tmpdir(), "bria-maj-"));
  const remote = join(base, "github.git");
  const member = join(base, "membre");
  const colleague = join(base, "collegue");
  run(base, "init", "--bare", "--initial-branch=main", remote);
  run(base, "clone", "-c", "core.autocrlf=false", remote, colleague);
  identity(colleague, "Fatou");
  run(colleague, "checkout", "-b", "main");
  writeFileSync(join(colleague, "index.html"), "<h1>Accueil</h1>\n");
  run(colleague, "add", "--all");
  run(colleague, "commit", "-m", "Premier commit");
  run(colleague, "push", "--set-upstream", "origin", "main");
  run(base, "clone", "-c", "core.autocrlf=false", remote, member);
  identity(member, "Ali");

  const merged = (file: string, content: string) => {
    writeFileSync(join(colleague, file), content);
    run(colleague, "add", "--all");
    run(colleague, "commit", "-m", `Ajout de ${file}`);
    run(colleague, "push");
  };
  return { member, merged };
}

const head = (folder: string) => run(folder, "rev-parse", "--abbrev-ref", "HEAD");

describe("mise à jour du dossier", () => {
  it("récupère la nouvelle version et dit ce qui a changé", async () => {
    const { member, merged } = setup();
    merged("package.json", "{}\n");
    expect(await updateToLatest(member, "main")).toEqual({
      status: "updated",
      changedFiles: ["package.json"],
      stashConflict: false,
    });
    expect(readFileSync(join(member, "package.json"), "utf8")).toBe("{}\n");
  }, 30_000);

  it("quitte la branche d'une commande pour revenir sur main", async () => {
    const { member, merged } = setup();
    run(member, "checkout", "-b", "bria/1-page");
    merged("page.html", "<p></p>\n");
    const outcome = await updateToLatest(member, "main");
    expect(outcome.status).toBe("updated");
    expect(head(member)).toBe("main");
  }, 30_000);

  it("ne touche à rien s'il y a du travail non enregistré, tant que le membre n'a pas choisi", async () => {
    const { member, merged } = setup();
    merged("page.html", "<p></p>\n");
    writeFileSync(join(member, "index.html"), "<h1>Modifié à la main</h1>\n");
    expect(await updateToLatest(member, "main")).toEqual({ status: "dirty" });
    expect(readFileSync(join(member, "index.html"), "utf8")).toContain("Modifié à la main");
    expect(() => readFileSync(join(member, "page.html"))).toThrow();
  }, 30_000);

  it("met le travail de côté et le réapplique si le membre le demande", async () => {
    const { member, merged } = setup();
    merged("page.html", "<p></p>\n");
    writeFileSync(join(member, "index.html"), "<h1>Modifié à la main</h1>\n");
    writeFileSync(join(member, "notes.txt"), "à garder\n");
    const outcome = await updateToLatest(member, "main", true);
    expect(outcome).toMatchObject({ status: "updated", stashConflict: false });
    expect(readFileSync(join(member, "page.html"), "utf8")).toBe("<p></p>\n");
    expect(readFileSync(join(member, "index.html"), "utf8")).toContain("Modifié à la main");
    expect(readFileSync(join(member, "notes.txt"), "utf8")).toBe("à garder\n");
    expect(run(member, "stash", "list")).toBe("");
  }, 30_000);

  it("signale un conflit et garde le travail dans la réserve de Git", async () => {
    const { member, merged } = setup();
    merged("index.html", "<h1>Version de Fatou</h1>\n");
    writeFileSync(join(member, "index.html"), "<h1>Version d'Ali</h1>\n");
    const outcome = await updateToLatest(member, "main", true);
    expect(outcome).toMatchObject({ status: "updated", stashConflict: true });
    expect(run(member, "stash", "list")).toContain("avant la mise à jour");
  }, 30_000);

  it("ne déloge pas un membre de sa propre branche", async () => {
    const { member, merged } = setup();
    run(member, "checkout", "-b", "mon-essai");
    merged("page.html", "<p></p>\n");
    expect(await updateToLatest(member, "main")).toEqual({ status: "other-branch", branch: "mon-essai" });
    expect(head(member)).toBe("mon-essai");
    // La branche principale locale avance quand même.
    expect(run(member, "show", "main:page.html")).toBe("<p></p>");
  }, 30_000);

  it("refuse d'écraser des commits locaux absents de GitHub", async () => {
    const { member, merged } = setup();
    merged("page.html", "<p></p>\n");
    writeFileSync(join(member, "local.txt"), "local\n");
    run(member, "add", "--all");
    run(member, "commit", "-m", "Commit local");
    const outcome = await updateToLatest(member, "main");
    expect(outcome.status).toBe("failed");
    expect(run(member, "log", "-1", "--format=%s")).toBe("Commit local");
  }, 30_000);
});

describe("dépendances à installer", () => {
  it("suit les fichiers changés et le fichier de verrouillage le plus proche", () => {
    const root = mkdtempSync(join(tmpdir(), "bria-deps-"));
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    mkdirSync(join(root, "api"));
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    expect(installCommands(root, ["index.html", "README.md"])).toEqual([]);
    // Monorepo : le fichier de la sous-application s'installe à la racine, une seule fois.
    expect(installCommands(root, ["pnpm-lock.yaml", "apps/web/package.json"])).toEqual([
      { dir: ".", command: "pnpm install" },
    ]);
    expect(installCommands(root, ["api/requirements.txt"])).toEqual([
      { dir: "api", command: "pip install -r requirements.txt" },
    ]);
  });

  it("utilise npm quand aucun fichier de verrouillage n'existe", () => {
    const root = mkdtempSync(join(tmpdir(), "bria-deps-"));
    expect(installCommands(root, ["package.json"])).toEqual([{ dir: ".", command: "npm install" }]);
  });
});
