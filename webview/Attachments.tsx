import type { Attachment } from "@br-ia/protocol";
import type { ChatStrings } from "../src/webviewMessages";
import { formatSize } from "./format";
import { post } from "./vscodeApi";

function icon(contentType: string): string {
  if (contentType.startsWith("image/")) return "file-media";
  if (contentType === "application/pdf") return "file-pdf";
  if (contentType === "application/zip") return "file-zip";
  if (contentType.startsWith("text/") || contentType === "application/json") return "file-text";
  return "file";
}

interface Props {
  attachments: Attachment[];
  strings: ChatStrings;
  locale: string;
  /** Dans la zone de saisie : chaque pièce peut être retirée avant l'envoi. */
  onRemove?: (attachment: Attachment) => void;
}

/** Pièces jointes : un clic ouvre le fichier, l'icône de téléchargement l'enregistre. */
export function Attachments({ attachments, strings, locale, onRemove }: Props) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attachments">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="attachment">
          <button
            type="button"
            className="attachment-open"
            title={attachment.name}
            disabled={Boolean(onRemove)}
            onClick={() => post({ type: "openAttachment", attachment, save: false })}
          >
            <span className={`codicon codicon-${icon(attachment.contentType)}`} aria-hidden="true" />
            <span className="attachment-name">{attachment.name}</span>
            <span className="attachment-size">{formatSize(attachment.size, locale)}</span>
          </button>
          {onRemove ? (
            <button
              type="button"
              className="icon-button"
              title={strings.removeAttachment}
              aria-label={`${strings.removeAttachment} : ${attachment.name}`}
              onClick={() => onRemove(attachment)}
            >
              <span className="codicon codicon-close" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              title={strings.download}
              aria-label={`${strings.download} ${attachment.name}`}
              onClick={() => post({ type: "openAttachment", attachment, save: true })}
            >
              <span className="codicon codicon-desktop-download" aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
