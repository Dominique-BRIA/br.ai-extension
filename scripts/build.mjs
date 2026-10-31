// Construit l'extension (Node) et la webview (navigateur) dans dist/.
// Option --watch : reconstruit à chaque modification.
import { context } from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  minify: !watch,
  // Le paquet @br-ia/protocol est un lien vers le dépôt backend :
  // ses dépendances (zod) sont résolues depuis ce dépôt-ci.
  preserveSymlinks: true,
  logLevel: "info",
};

const builds = await Promise.all([
  context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    // vscode est fourni par l'éditeur ; bufferutil et utf-8-validate sont des options de ws.
    external: ["vscode", "bufferutil", "utf-8-validate"],
  }),
  context({
    ...shared,
    entryPoints: ["webview/main.tsx"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
  }),
]);

if (watch) {
  await Promise.all(builds.map((b) => b.watch()));
} else {
  await Promise.all(builds.map((b) => b.rebuild()));
  await Promise.all(builds.map((b) => b.dispose()));
}
