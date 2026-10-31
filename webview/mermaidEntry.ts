// Point d'entrée séparé (dist/mermaid.js) : Mermaid est volumineux, il n'est chargé
// qu'à l'affichage du premier diagramme. Il s'expose sur window.briaMermaid.
import mermaid from "mermaid";

let theme: string | undefined;

async function render(id: string, code: string, dark: boolean): Promise<string> {
  const wanted = dark ? "dark" : "default";
  if (theme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: wanted });
    theme = wanted;
  }
  const { svg } = await mermaid.render(id, code);
  return svg;
}

(window as unknown as { briaMermaid: { render: typeof render } }).briaMermaid = { render };
