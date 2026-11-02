import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Le module vscode n'existe que dans l'éditeur : réglage du push et question au membre simulés.
const settings = { pushMode: "auto" };
const answers: (string | undefined)[] = [];
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: (key: "pushMode", fallback: string) => settings[key] ?? fallback }),
  },
  window: { showInformationMessage: async () => answers.shift() },
  l10n: {
    t: (text: string, ...args: unknown[]) => text.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)])),
  },
}));

const { prepareBranch, saveBranch } = await import("../src/cook/git");

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Lit le « GitHub » local : Git peut refuser de travailler directement dans un dépôt nu. */
const inRemote = (remote: string, ...args: string[]) => run(join(remote, ".."), "--git-dir", remote, ...args);

/** Un « GitHub » local (dépôt nu) et le clone d'un membre, avec un premier commit sur main. */
function setup() {
  const base = mkdtempSync(join(tmpdir(), "bria-git-"));
  const remote = join(base, "github.git");
  const member = join(base, "membre");
  run(base, "init", "--bare", "--initial-branch=main", remote);
  run(base, "clone", remote, member);
  run(member, "config", "user.name", "Ali Membre");
  run(member, "config", "user.email", "ali@exemple.org");
  run(member, "checkout", "-b", "main");
  writeFileSync(join(member, "index.html"), "<h1>Accueil</h1>\n");
  run(member, "add", "--all");
  run(member, "commit", "-m", "Premier commit");
  run(member, "push", "--set-upstream", "origin", "main");
  return { remote, member };
}

const saved = (output: string) =>
  JSON.parse(output) as { commit: string | null; pushed: boolean; note: string };

describe("Git du cuisinier", () => {
  beforeEach(() => {
    settings.pushMode = "auto";
    answers.length = 0;
  });

  it("crée la branche depuis main, commit au nom du membre et pousse", async () => {
    const { remote, member } = setup();
    const prepared = await prepareBranch(member, "bria/1-page-contact", "main");
    expect(prepared).toEqual({ ok: true, output: "Branche bria/1-page-contact créée depuis main." });

    writeFileSync(join(member, "contact.html"), "<form></form>\n");
    const result = await saveBranch(member, "bria/1-page-contact", "Page de contact\n\nCommande n° 1.");
    expect(result.ok).toBe(true);
    const { commit, pushed } = saved(result.output);
    expect(pushed).toBe(true);
    expect(inRemote(remote, "rev-parse", "--short", "bria/1-page-contact")).toBe(commit);
    // Le commit porte le nom du membre, sans mention de l'IA.
    const log = inRemote(remote, "log", "-1", "--format=%an <%ae>%n%B", "bria/1-page-contact");
    expect(log).toContain("Ali Membre <ali@exemple.org>");
    expect(log).not.toMatch(/co-authored|claude|\bIA\b/i);
  }, 30_000);

  it("refuse de toucher au travail non enregistré du membre", async () => {
    const { member } = setup();
    writeFileSync(join(member, "index.html"), "<h1>Modifié à la main</h1>\n");
    const prepared = await prepareBranch(member, "bria/2-pied", "main");
    expect(prepared.ok).toBe(false);
    expect(prepared.output).toContain("changements non enregistrés");
    expect(run(member, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readFileSync(join(member, "index.html"), "utf8")).toContain("Modifié à la main");
  }, 30_000);

  it("demande avant de pousser, et garde le commit si le membre refuse", async () => {
    const { remote, member } = setup();
    settings.pushMode = "ask";
    answers.push("Later");
    await prepareBranch(member, "bria/3-faq", "main");
    writeFileSync(join(member, "faq.md"), "# FAQ\n");
    const result = saved((await saveBranch(member, "bria/3-faq", "FAQ")).output);
    expect(result.pushed).toBe(false);
    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(() => inRemote(remote, "rev-parse", "--verify", "bria/3-faq")).toThrow();
  }, 30_000);

  it("reprend sur une autre machine une branche déjà poussée", async () => {
    const { remote, member } = setup();
    await prepareBranch(member, "bria/4-blog", "main");
    writeFileSync(join(member, "blog.md"), "# Blog\n");
    await saveBranch(member, "bria/4-blog", "Blog");

    const other = join(remote, "..", "autre-machine");
    run(join(remote, ".."), "clone", remote, other);
    run(other, "config", "user.name", "Fatou");
    run(other, "config", "user.email", "fatou@exemple.org");
    const resumed = await prepareBranch(other, "bria/4-blog", "main");
    expect(resumed).toEqual({ ok: true, output: "Branche bria/4-blog reprise depuis GitHub." });
    // Git peut convertir les fins de ligne en récupérant les fichiers sous Windows.
    expect(readFileSync(join(other, "blog.md"), "utf8").replace(/\r\n/g, "\n")).toBe("# Blog\n");
  }, 30_000);

  it("ne fait pas de commit vide", async () => {
    const { member } = setup();
    await prepareBranch(member, "bria/5-rien", "main");
    expect(saved((await saveBranch(member, "bria/5-rien", "Rien")).output)).toEqual({
      commit: null,
      pushed: false,
      note: "Aucun changement à enregistrer dans Git.",
    });
  }, 30_000);
});
