import { useEffect, useId, useState } from "react";

type Renderer = { render(id: string, code: string, dark: boolean): Promise<string> };

// Nonce du script principal, réutilisé pour charger Mermaid (la politique de sécurité l'exige).
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? "";
let loading: Promise<Renderer> | undefined;

function loadMermaid(): Promise<Renderer> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = document.getElementById("root")?.dataset.mermaid ?? "";
    script.nonce = nonce;
    script.onload = () => {
      const renderer = (window as unknown as { briaMermaid?: Renderer }).briaMermaid;
      if (renderer) resolve(renderer);
      else reject(new Error("Mermaid indisponible"));
    };
    script.onerror = () => reject(new Error("Mermaid indisponible"));
    document.head.append(script);
  });
  return loading;
}

const isDark = () =>
  document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");

/** Un diagramme Mermaid. En cas d'erreur, on montre le code source. */
export function MermaidDiagram({ code, errorLabel }: { code: string; errorLabel: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((renderer) => renderer.render(id, code, isDark()))
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, code]);

  if (failed) {
    return (
      <div className="diagram-error">
        <p>{errorLabel}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!svg) return <pre className="diagram-loading">{code}</pre>;
  // Le SVG est produit par Mermaid en mode « strict », qui neutralise le contenu actif.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: rendu SVG de Mermaid, assaini par securityLevel strict.
  return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
