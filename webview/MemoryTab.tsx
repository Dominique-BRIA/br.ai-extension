import type { MemoryItem, MemoryType } from "@br-ia/protocol";
import type { ChatStrings } from "../src/webviewMessages";
import { authorName, formatDay } from "./format";
import { post } from "./vscodeApi";

const GROUPS: (MemoryType | "history")[] = ["decision", "question", "task", "compromise", "history"];
const ICONS: Record<MemoryType | "history", string> = {
  decision: "law",
  question: "question",
  task: "tasklist",
  compromise: "git-merge",
  history: "history",
};

interface Props {
  items: MemoryItem[];
  isChef: boolean;
  myUserId: string;
  strings: ChatStrings;
  locale: string;
  /** Aller au message d'origine dans le chat. */
  onShowMessage(messageId: string): void;
}

/** Onglet Mémoire : ce que le serveur a noté, avec les actions possibles sur chaque élément. */
export function MemoryTab({ items, isChef, myUserId, strings, locale, onShowMessage }: Props) {
  const groupItems = (group: MemoryType | "history") =>
    group === "history"
      ? items.filter((item) => item.status !== "open").reverse()
      : items.filter((item) => item.type === group && item.status === "open");

  return (
    <div className="tab-body">
      <div className="toolbar">
        <span className="spacer" />
        <button
          type="button"
          className="chip-button"
          onClick={() => post({ type: "command", command: "openMemoryDocument" })}
        >
          <span className="codicon codicon-open-preview" aria-hidden="true" />
          {strings.openMemoryDocument}
        </button>
      </div>
      {items.length === 0 && <p className="empty-text">{strings.noMemory}</p>}
      {GROUPS.map((group) => {
        const list = groupItems(group);
        if (list.length === 0) return null;
        return (
          <section key={group} className="memory-group">
            <h3 className="subtitle">
              <span className={`codicon codicon-${ICONS[group]}`} aria-hidden="true" />
              {strings.memoryGroups[group]}
              <span className="count">{list.length}</span>
            </h3>
            <ul className="memory-list">
              {list.map((item) => (
                <li key={item.id} className={`memory-item ${item.status}`}>
                  <p className="memory-text">{item.text}</p>
                  <div className="memory-meta">
                    <span>
                      {authorName(item.proposedBy, strings, myUserId)} ·{" "}
                      {formatDay(item.createdAt, locale, strings)}
                      {item.status !== "open" && ` · ${strings.memoryStatus[item.status]}`}
                    </span>
                    <span className="memory-actions">
                      {item.sourceMessageId && (
                        <button
                          type="button"
                          className="icon-button"
                          title={strings.showInChat}
                          aria-label={strings.showInChat}
                          onClick={() => item.sourceMessageId && onShowMessage(item.sourceMessageId)}
                        >
                          <span className="codicon codicon-comment" aria-hidden="true" />
                        </button>
                      )}
                      {item.type !== "decision" && item.status === "open" && (
                        <button
                          type="button"
                          className="icon-button"
                          title={strings.resolve}
                          aria-label={strings.resolve}
                          onClick={() => post({ type: "memoryStatus", itemId: item.id, status: "resolved" })}
                        >
                          <span className="codicon codicon-check" aria-hidden="true" />
                        </button>
                      )}
                      {item.type !== "decision" && item.status === "resolved" && (
                        <button
                          type="button"
                          className="icon-button"
                          title={strings.reopen}
                          aria-label={strings.reopen}
                          onClick={() => post({ type: "memoryStatus", itemId: item.id, status: "open" })}
                        >
                          <span className="codicon codicon-discard" aria-hidden="true" />
                        </button>
                      )}
                      {item.type === "decision" && item.status === "open" && isChef && (
                        <button
                          type="button"
                          className="icon-button"
                          title={strings.stopDecision}
                          aria-label={strings.stopDecision}
                          onClick={() => post({ type: "memoryStatus", itemId: item.id, status: "stopped" })}
                        >
                          <span className="codicon codicon-debug-stop" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
