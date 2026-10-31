// Construit l'extension (Node) et la webview (navigateur) dans dist/.
// Option --watch : reconstruit à chaque modification.
// Voir scripts/esbuild.mjs pour la façon dont esbuild est lancé.
import { existsSync, statSync } from "node:fs";
import { esbuild } from "./esbuild.mjs";

/** Vrai si `output` existe et est plus récent que toutes ses sources. */
function upToDate(output, sources) {
  if (!existsSync(output)) return false;
  const built = statSync(output).mtimeMs;
  return sources.every((source) => statSync(source).mtimeMs < built);
}

const watch = process.argv.includes("--watch");

const shared = [
  "--bundle",
  "--sourcemap",
  // Le paquet @br-ia/protocol est un lien vers le dépôt backend :
  // ses dépendances (zod) sont résolues depuis ce dépôt-ci.
  "--preserve-symlinks",
  "--log-level=warning",
  ...(watch ? ["--watch"] : ["--minify"]),
];

const builds = [
  [
    "src/extension.ts",
    "--outfile=dist/extension.js",
    "--platform=node",
    "--format=cjs",
    "--target=node20",
    // vscode est fourni par l'éditeur ; bufferutil et utf-8-validate sont des options de ws.
    "--external:vscode",
    "--external:bufferutil",
    "--external:utf-8-validate",
  ],
  [
    "webview/main.tsx",
    "--outfile=dist/webview.js",
    "--platform=browser",
    "--format=iife",
    "--target=es2022",
    "--jsx=automatic",
    // Police des icônes Codicons, copiée dans dist/.
    "--loader:.ttf=file",
  ],
  [
    // Mermaid, chargé seulement à l'affichage du premier diagramme.
    "webview/mermaidEntry.ts",
    "--outfile=dist/mermaid.js",
    "--platform=browser",
    "--format=iife",
    "--target=es2022",
  ],
];

// L'une après l'autre : plusieurs esbuild en parallèle échouent plus souvent (voir esbuild.mjs).
for (const args of builds) {
  if (
    args[0] === "webview/mermaidEntry.ts" &&
    upToDate("dist/mermaid.js", ["webview/mermaidEntry.ts", "node_modules/mermaid/package.json"])
  ) {
    continue;
  }
  await esbuild([...args, ...shared]);
}
