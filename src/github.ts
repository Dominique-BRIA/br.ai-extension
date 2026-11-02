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

/**
 * Lit un dépôt avec le compte GitHub connecté à VS Code (le membre l'autorise une fois). Ce
 * jeton reste sur la machine : il n'est jamais envoyé au serveur <br/>.
 */
export async function githubRepo(fullName: string): Promise<GitHubRepo> {
  const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
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
