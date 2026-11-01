import type { Element, ElementContent } from "hast";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./Mermaid";

/** Texte brut d'un nœud HTML (pour lire le code d'un bloc). */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/** Le code d'un bloc ```mermaid, s'il s'agit de cela. */
function mermaidCode(pre: Element | undefined): string | null {
  const code = pre?.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  const classes = code.properties.className;
  return Array.isArray(classes) && classes.includes("language-mermaid") ? textOf(code) : null;
}

/**
 * Le nom « <br>.ia » ressemble à une balise HTML, que le rendu supprimerait : hors du code,
 * on l'écrit avec des entités pour qu'il s'affiche tel quel.
 */
export function escapeBrand(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replaceAll("<br>.ia", "&lt;br&gt;.ia")))
    .join("");
}

/**
 * Rendu Markdown d'un message : tableaux, listes de tâches, code coloré, diagrammes Mermaid.
 * Le HTML brut n'est jamais interprété.
 */
export const Markdown = memo(function Markdown({
  text,
  diagramError,
}: {
  text: string;
  diagramError: string;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} title={href}>
              {children}
            </a>
          ),
          pre: ({ node, children }) => {
            const code = mermaidCode(node);
            return code !== null ? (
              <MermaidDiagram code={code} errorLabel={diagramError} />
            ) : (
              <pre>{children}</pre>
            );
          },
        }}
      >
        {escapeBrand(text)}
      </ReactMarkdown>
    </div>
  );
});
