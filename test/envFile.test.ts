import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGitignored, envValues, maskSecrets, mergeEnv } from "../src/cook/envFile";

describe("fichier .env", () => {
  it("remplace les variables du coffre et garde le reste", () => {
    const existing = "# Base\nDATABASE_URL=ancienne\nPORT=3000\n";
    const merged = mergeEnv(existing, [
      { name: "DATABASE_URL", value: "postgres://u:p@h/b" },
      { name: "API_KEY", value: "clé avec espaces" },
    ]);
    expect(merged).toBe('# Base\nDATABASE_URL=postgres://u:p@h/b\nPORT=3000\nAPI_KEY="clé avec espaces"\n');
  });

  it("crée le contenu à partir de rien", () => {
    expect(mergeEnv("", [{ name: "A", value: "b" }])).toBe("A=b\n");
  });

  it("lit les valeurs, guillemets retirés", () => {
    expect(envValues('A=1234\nexport B="deux mots"\n# C=commentaire\nD=\n')).toEqual(["1234", "deux mots"]);
  });
});

describe("masquage des secrets", () => {
  it("remplace chaque valeur, même incluse dans une autre, et ignore les valeurs trop courtes", () => {
    const text = "connexion à postgres://u:motdepasse@h/b avec motdepasse, port 80";
    expect(maskSecrets(text, ["motdepasse", "postgres://u:motdepasse@h/b", "80"])).toBe(
      "connexion à **** avec ****, port 80",
    );
  });
});

describe(".gitignore", () => {
  it("ajoute le .env une seule fois", async () => {
    const root = await mkdtemp(join(tmpdir(), "bria-"));
    await writeFile(join(root, ".gitignore"), "node_modules");
    expect(await ensureGitignored(root, ".env")).toBe(true);
    expect(await ensureGitignored(root, ".env")).toBe(false);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("node_modules\n.env\n");
  });

  it("reconnaît un motif qui couvre déjà le fichier", async () => {
    const root = await mkdtemp(join(tmpdir(), "bria-"));
    await writeFile(join(root, ".gitignore"), ".env*\n");
    expect(await ensureGitignored(root, ".env.local")).toBe(false);
  });
});
