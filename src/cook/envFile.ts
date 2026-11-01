import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SecretValue {
  name: string;
  value: string;
}

/** Valeur écrite dans un `.env` : entre guillemets dès qu'elle contient des espaces ou des caractères spéciaux. */
function quote(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Le `.env` mis à jour : les variables du coffre remplacent celles du même nom, les autres
 * lignes (commentaires, variables locales) sont gardées, les nouvelles s'ajoutent à la fin.
 */
export function mergeEnv(existing: string, secrets: SecretValue[]): string {
  const pending = new Map(secrets.map((secret) => [secret.name, secret.value]));
  const lines = existing === "" ? [] : existing.replace(/\r?\n$/, "").split(/\r?\n/);
  const merged = lines.map((line) => {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !pending.has(name)) return line;
    const value = pending.get(name) ?? "";
    pending.delete(name);
    return `${name}=${quote(value)}`;
  });
  for (const [name, value] of pending) merged.push(`${name}=${quote(value)}`);
  return `${merged.join("\n")}\n`;
}

/** Les valeurs d'un `.env`, pour les masquer dans ce que l'IA lit. */
export function envValues(content: string): string[] {
  const values: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = match[1].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (value) values.push(value);
  }
  return values;
}

/**
 * Remplace par `****` chaque valeur secrète présente dans un texte. Les valeurs trop courtes
 * (moins de 4 caractères) sont ignorées : les masquer rendrait le texte illisible.
 */
export function maskSecrets(text: string, values: Iterable<string>): string {
  // Les plus longues d'abord, pour qu'une valeur contenue dans une autre ne laisse pas de reste.
  const sorted = [...new Set(values)]
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
  let masked = text;
  for (const value of sorted) masked = masked.split(value).join("****");
  return masked;
}

/** Ajoute le chemin au `.gitignore` du projet s'il n'y figure pas. Renvoie vrai s'il a fallu l'ajouter. */
export async function ensureGitignored(root: string, relativePath: string): Promise<boolean> {
  const file = join(root, ".gitignore");
  const content = await readFile(file, "utf8").catch(() => "");
  const entry = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const listed = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\//, ""))
    .some((line) => line === entry || line === `${entry}*` || (entry.startsWith(".env") && line === ".env*"));
  if (listed) return false;
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  await writeFile(file, `${content}${separator}${entry}\n`);
  return true;
}
