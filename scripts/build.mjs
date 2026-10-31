// Construit l'extension (Node) et la webview (navigateur) dans dist/.
// Option --watch : reconstruit à chaque modification.
// Voir scripts/esbuild.mjs pour la façon dont esbuild est lancé.
import { esbuild } from "./esbuild.mjs";

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

await Promise.all(builds.map((args) => esbuild([...args, ...shared])));
