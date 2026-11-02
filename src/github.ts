import * as vscode from "vscode";

/**
 * « propriétaire/nom » à partir de ce qu'un membre colle : le nom court, l'adresse du dépôt
 * sur github.com, ou l'adresse de clonage (https ou ssh). `null` si ce n'est pas GitHub.
 */
export function parseRepo(text: string): string | null {
  const value = text
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const match =
    /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(
      value,
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

export interface GitHubRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * Lit un dépôt avec le compte GitHub connecté à VS Code (le membre l'autorise une fois). Ce
 * jeton reste sur la machine : il n'est jamais envoyé au serveur <br/>.
 */
export async function githubRepo(fullName: string): Promise<GitHubRepo> {
  const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${session.accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) {
    throw new Error(
      vscode.l10n.t(
        "Repository {0} not found, or not accessible with your GitHub account ({1}).",
        fullName,
        session.account.label,
      ),
    );
  }
  if (!response.ok) throw new Error(vscode.l10n.t("GitHub answered with error {0}.", response.status));
  const json = (await response.json()) as { full_name: string; default_branch: string; private: boolean };
  return { fullName: json.full_name, defaultBranch: json.default_branch, private: json.private };
}

export interface MergeOutcome {
  number: number;
  url: string;
  merged: boolean;
  /** Pourquoi GitHub refuse la fusion : conflit, vérifications en cours, relecture exigée… */
  reason?: string;
}

/**
 * Ouvre la pull request de la commande (ou reprend celle qui existe) et la fusionne, avec l'accès
 * GitHub du membre. Si GitHub refuse la fusion, la pull request reste ouverte et la raison revient.
 */
export async function mergeBranch(
  fullName: string,
  change: { branch: string; base: string; title: string; body: string },
): Promise<MergeOutcome> {
  const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`https://api.github.com/repos/${fullName}${path}`, {
      method,
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${session.accessToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, ok: response.ok, json };
  };
  const refused = (status: number, json: Record<string, unknown>) =>
    new Error(vscode.l10n.t("GitHub refused: {0}", String(json.message ?? status)));

  const owner = fullName.split("/")[0];
  const found = await call("GET", `/pulls?state=all&head=${owner}:${encodeURIComponent(change.branch)}`);
  if (!found.ok) throw refused(found.status, found.json);
  const existing = (found.json as unknown as PullRequest[]).find(
    (pull) => pull.state === "open" || pull.merged_at,
  );
  let pull = existing;
  if (!pull) {
    const created = await call("POST", "/pulls", {
      title: change.title,
      head: change.branch,
      base: change.base,
      body: change.body,
    });
    if (!created.ok) throw refused(created.status, created.json);
    pull = created.json as unknown as PullRequest;
  }
  const opened = { number: pull.number, url: pull.html_url };
  if (pull.merged_at) return { ...opened, merged: true };

  // Tous les dépôts n'autorisent pas la même méthode de fusion.
  let reason = "";
  for (const method of ["merge", "squash", "rebase"]) {
    const merge = await call("PUT", `/pulls/${pull.number}/merge`, { merge_method: method });
    if (merge.ok) return { ...opened, merged: true };
    reason = String(merge.json.message ?? merge.status);
    if (merge.status !== 405 || !/not allowed/i.test(reason)) break;
  }
  return { ...opened, merged: false, reason };
}

interface PullRequest {
  number: number;
  html_url: string;
  state: string;
  merged_at: string | null;
}
