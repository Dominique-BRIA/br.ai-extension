import type { ProjectFile, ZipEntriesResponse } from "@br-ia/protocol";
import { useEffect, useState } from "react";
import type { ChatStrings, ToWebview } from "../src/webviewMessages";
import { formatSize, formatTime } from "./format";
import { post } from "./vscodeApi";

type Entries = ZipEntriesResponse["entries"];

interface Props {
  projectId: string;
  /** Un nouveau message peut apporter un fichier : la liste se recharge. */
  messageCount: number;
  strings: ChatStrings;
  locale: string;
}

/** Tous les fichiers du projet : ceux du cuisinier et ceux envoyés par les membres dans le chat. */
export function FilesTab({ projectId, messageCount, strings, locale }: Props) {
  const [files, setFiles] = useState<ProjectFile[] | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entries | null>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount sert à recharger la liste.
  useEffect(() => {
    post({ type: "loadFiles" });
  }, [projectId, messageCount]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type === "files" && message.projectId === projectId) setFiles(message.files);
      if (message.type === "zipEntries") {
        setEntries((current) => ({ ...current, [message.attachmentId]: message.entries }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectId]);

  const toggle = (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!entries[id]) post({ type: "loadZipEntries", attachmentId: id });
  };

  return (
    <div className="tab-body">
      <div className="section-head">
        <div>
          <h2 className="page-title">{strings.filesTitle}</h2>
          <p className="page-subtitle">{strings.filesSubtitle}</p>
        </div>
      </div>
      {files === null && <p className="page-subtitle">{strings.filesError}</p>}
      {files?.length === 0 && <p className="page-subtitle">{strings.filesEmpty}</p>}
      <ul className="file-list">
        {files?.map((file) => {
          const zip = file.contentType === "application/zip";
          const expanded = open === file.id;
          const content = entries[file.id];
          return (
            <li key={file.id} className="file-item">
              <div className="file-name">
                <span className={`codicon codicon-${zip ? "file-zip" : "file"}`} aria-hidden="true" />
                <span>{file.name}</span>
              </div>
              <div className="file-meta">
                {file.uploadedBy ?? strings.theCook} · {formatTime(file.createdAt, locale)} ·{" "}
                {formatSize(file.size, locale)}
              </div>
              <div className="file-actions">
                {zip && (
                  <button
                    type="button"
                    className="ghost-button"
                    aria-expanded={expanded}
                    onClick={() => toggle(file.id)}
                  >
                    <span
                      className={`codicon codicon-chevron-${expanded ? "up" : "down"}`}
                      aria-hidden="true"
                    />
                    {strings.showContent}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "openAttachment", attachment: file, save: false })}
                >
                  {strings.openItem}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "openAttachment", attachment: file, save: true })}
                >
                  {strings.download}
                </button>
              </div>
              {expanded && content === null && <p className="page-subtitle">{strings.filesError}</p>}
              {expanded && content && (
                <ul className="file-entries">
                  {content.map((entry) => (
                    <li key={entry.path}>
                      <span className="file-entry-name">
                        {entry.path} <span className="file-meta">({formatSize(entry.size, locale)})</span>
                      </span>
                      <span className="file-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            post({
                              type: "openZipEntry",
                              attachmentId: file.id,
                              path: entry.path,
                              save: false,
                            })
                          }
                        >
                          {strings.openItem}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            post({
                              type: "openZipEntry",
                              attachmentId: file.id,
                              path: entry.path,
                              save: true,
                            })
                          }
                        >
                          {strings.download}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
