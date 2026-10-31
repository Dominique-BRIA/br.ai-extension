import type { MemoryItem, MemoryType, Order } from "@br-ia/protocol";
import type { ChatStrings } from "../src/webviewMessages";
import { authorName, formatDay, orderFiles } from "./format";
import { activeOrder } from "./Orders";
import { post } from "./vscodeApi";

const GROUPS: (MemoryType | "history")[] = ["question", "task", "compromise", "history"];
const ICONS: Record<MemoryType | "history", string> = {
  decision: "law",
  question: "question",
  task: "tasklist",
  compromise: "git-merge",
  history: "history",
};

interface Props {
  items: MemoryItem[];
  orders: Order[];
  projectName: string;
  isChef: boolean;
  myUserId: string;
  strings: ChatStrings;
  locale: string;
  /** Aller au message d'origine dans le chat. */
  onShowMessage(messageId: string): void;
}

/** Onglet Mémoire & Documents : ce qui s'élabore, les documents produits et la mémoire du projet. */
export function MemoryTab({
  items,
  orders,
  projectName,
  isChef,
  myUserId,
  strings,
  locale,
  onShowMessage,
}: Props) {
  const current = activeOrder(orders);
  const draft = current?.status === "running" ? orderFiles(current)[0] : undefined;

  // Documents produits par le cuisinier, du plus récent au plus ancien, sans doublon.
  const documents: { path: string; order: Order }[] = [];
  for (const order of orders) {
    for (const path of orderFiles(order)) {
      if (!documents.some((document) => document.path === path)) documents.push({ path, order });
    }
  }

  const decisions = items.filter((item) => item.type === "decision" && item.status === "open");
  const groupItems = (group: MemoryType | "history") =>
    group === "history"
      ? items.filter((item) => item.status !== "open").reverse()
      : items.filter((item) => item.type === group && item.status === "open");

  const actions = (item: MemoryItem) => (
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
  );

  return (
    <div className="tab-body">
      <div className="section-head">
        <div>
          <h2 className="page-title">{strings.memoryTitle}</h2>
          <p className="page-subtitle">{strings.memorySubtitle.replace("{0}", projectName)}</p>
        </div>
        <button
          type="button"
          className="pill pill-button"
          onClick={() => post({ type: "command", command: "openMemoryDocument" })}
        >
          <span className="codicon codicon-markdown" aria-hidden="true" />
          .md
        </button>
      </div>

      {current?.status === "running" && (
        <article className="draft-card">
          <span className="pill status running">
            <span className="status-dot running" aria-hidden="true" />
            {strings.inProgress}
          </span>
          <h3 className="active-order-title">{current.title}</h3>
          <div className="cook-machine">
            <span className="codicon codicon-tools" aria-hidden="true" /> {strings.byCook}
          </div>
          <div className="progress-track running">
            <div className="progress-bar" />
          </div>
          {draft && (
            <button
              type="button"
              className="secondary-button wide"
              onClick={() => post({ type: "openProjectFile", path: draft })}
            >
              <span className="codicon codicon-eye" aria-hidden="true" />
              {strings.preview}
            </button>
          )}
        </article>
      )}

      {documents.length > 0 && (
        <section>
          <div className="section-head small">
            <h3 className="subtitle">{strings.recentDocuments}</h3>
            <span className="meta">{strings.fileCount.replace("{0}", String(documents.length))}</span>
          </div>
          {documents.slice(0, 8).map(({ path, order }) => (
            <button
              key={path}
              type="button"
              className="document-row"
              onClick={() => post({ type: "openProjectFile", path })}
            >
              <span className="document-icon">
                <span
                  className={`codicon codicon-${order.status === "running" ? "edit" : "file"}`}
                  aria-hidden="true"
                />
              </span>
              <span className="document-text">
                <span className="document-name">{path}</span>
                <span className="meta">
                  {order.status === "running"
                    ? strings.orderStatus.running
                    : formatDay(order.updatedAt, locale, strings)}{" "}
                  · {strings.fromOrder.replace("{0}", String(order.number))}
                </span>
              </span>
              <span className="codicon codicon-chevron-right" aria-hidden="true" />
            </button>
          ))}
        </section>
      )}

      {decisions.map((item) => (
        <article key={item.id} className="decision-card">
          <div className="decision-head">
            <span className="codicon codicon-law" aria-hidden="true" />
            {strings.activeDecision}
            <span className="spacer" />
            {actions(item)}
          </div>
          <p className="memory-text">{item.text}</p>
          <div className="meta">
            {authorName(item.proposedBy, strings, myUserId)} · {formatDay(item.createdAt, locale, strings)}
          </div>
        </article>
      ))}

      {GROUPS.map((group) => {
        const list = groupItems(group);
        if (list.length === 0) return null;
        return (
          <section key={group}>
            <h3 className="subtitle">
              <span className={`codicon codicon-${ICONS[group]}`} aria-hidden="true" />
              {strings.memoryGroups[group]}
              <span className="count">{list.length}</span>
            </h3>
            {list.map((item) => (
              <div key={item.id} className={`memory-item ${item.status}`}>
                <p className="memory-text">{item.text}</p>
                <div className="memory-meta">
                  <span>
                    {authorName(item.proposedBy, strings, myUserId)} ·{" "}
                    {formatDay(item.createdAt, locale, strings)}
                    {item.status !== "open" && ` · ${strings.memoryStatus[item.status]}`}
                  </span>
                  {actions(item)}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {items.length === 0 && documents.length === 0 && <p className="empty-text">{strings.noMemory}</p>}

      <button
        type="button"
        className="primary-button wide new-note"
        onClick={() => post({ type: "command", command: "newNote" })}
      >
        <span className="codicon codicon-add" aria-hidden="true" />
        {strings.newNote}
      </button>
    </div>
  );
}
