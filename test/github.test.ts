import { beforeEach, describe, expect, it, vi } from "vitest";

// Le module vscode n'existe que dans l'éditeur : compte GitHub et textes simulés.
vi.mock("vscode", () => ({
  authentication: { getSession: async () => ({ accessToken: "jeton", account: { label: "ali" } }) },
  l10n: {
    t: (text: string, ...args: unknown[]) => text.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)])),
  },
}));

const { mergeBranch, parseRepo } = await import("../src/github");

const change = { branch: "bria/3-faq", base: "main", title: "FAQ", body: "Commande n° 3." };
const pull = { number: 12, html_url: "https://github.com/ali/site/pull/12", state: "open", merged_at: null };

/** Répond aux appels de GitHub dans l'ordre et garde la trace de chacun. */
function github(...answers: [number, unknown][]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({
      method: String(init.method),
      path: url.replace("https://api.github.com/repos/ali/site", ""),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const [status, json] = answers.shift() ?? [500, {}];
    return new Response(JSON.stringify(json), { status });
  });
  return calls;
}

describe("GitHub", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("reconnaît un dépôt sous toutes ses formes", () => {
    expect(parseRepo("ali/site")).toBe("ali/site");
    expect(parseRepo("https://github.com/ali/site.git")).toBe("ali/site");
    expect(parseRepo("git@github.com:ali/site.git\n")).toBe("ali/site");
    expect(parseRepo("https://gitlab.com/ali/site")).toBeNull();
  });

  it("ouvre la pull request puis la fusionne", async () => {
    const calls = github([200, []], [201, pull], [200, { merged: true }]);
    expect(await mergeBranch("ali/site", change)).toEqual({ number: 12, url: pull.html_url, merged: true });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "PUT"]);
    expect(calls[0]?.path).toBe("/pulls?state=all&head=ali:bria%2F3-faq");
    expect(calls[1]?.body).toEqual({
      title: "FAQ",
      head: "bria/3-faq",
      base: "main",
      body: "Commande n° 3.",
    });
  });

  it("reprend la pull request déjà ouverte", async () => {
    const calls = github([200, [pull]], [200, { merged: true }]);
    expect((await mergeBranch("ali/site", change)).merged).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  });

  it("ne refusionne pas une pull request déjà fusionnée", async () => {
    const calls = github([200, [{ ...pull, state: "closed", merged_at: "2026-11-02T10:00:00Z" }]]);
    expect((await mergeBranch("ali/site", change)).merged).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("essaie la méthode de fusion que le dépôt autorise", async () => {
    const calls = github(
      [200, [pull]],
      [405, { message: "Merge commits are not allowed on this repository." }],
      [200, { merged: true }],
    );
    expect((await mergeBranch("ali/site", change)).merged).toBe(true);
    expect(calls.slice(1).map((call) => call.body)).toEqual([
      { merge_method: "merge" },
      { merge_method: "squash" },
    ]);
  });

  it("laisse la pull request ouverte quand GitHub refuse la fusion", async () => {
    const calls = github([200, [pull]], [405, { message: "Pull Request is not mergeable" }]);
    expect(await mergeBranch("ali/site", change)).toEqual({
      number: 12,
      url: pull.html_url,
      merged: false,
      reason: "Pull Request is not mergeable",
    });
    expect(calls).toHaveLength(2);
  });

  it("explique pourquoi la pull request n'a pas pu être ouverte", async () => {
    github([200, []], [422, { message: "No commits between main and bria/3-faq" }]);
    await expect(mergeBranch("ali/site", change)).rejects.toThrow("No commits between main");
  });
});
