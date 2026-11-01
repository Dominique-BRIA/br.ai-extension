import type { Notification } from "@br-ia/protocol";
import { useEffect, useState } from "react";
import type { ChatStrings } from "../src/webviewMessages";
import { formatRelative } from "./format";
import { post } from "./vscodeApi";

interface Props {
  /** De la plus récente à la plus ancienne. */
  items: Notification[];
  /** Nombre de notifications non lues : les premières de la liste. */
  unread: number;
  strings: ChatStrings;
  locale: string;
  onBack(): void;
  /** Appelé quand on ouvre une notification : le panneau revient au chat. */
  onOpen(): void;
}

const ICONS: Record<Notification["kind"], string> = {
  mention: "mention",
  reply: "comment-discussion",
  order: "tools",
};

/** Les mentions, les réponses de l'IA et les commandes terminées, dans tous les projets. */
export function Notifications({ items, unread, strings, locale, onBack, onOpen }: Props) {
  // Ce qui était non lu à l'ouverture reste signalé pendant la consultation.
  const [fresh] = useState(() => new Set(items.slice(0, unread).map((item) => item.id)));

  useEffect(() => {
    post({ type: "notificationsSeen" });
  }, []);

  const title = (item: Notification) => {
    switch (item.kind) {
      case "mention":
        return strings.notifMention.replace("{0}", item.author);
      case "reply":
        return strings.notifReply;
      case "order":
        return `${strings.order.replace("{0}", item.text.split(" · ")[0] ?? "")} · ${
          item.orderStatus ? strings.orderStatus[item.orderStatus] : ""
        }`;
    }
  };

  return (
    <div className="panel-root">
      <ScreenHeader title={strings.notificationsTitle} strings={strings} onBack={onBack} />
      <div className="tab-body">
        {items.length === 0 && (
          <article className="workspace-card onboarding">
            <div className="workspace-text">
              <p className="meta">{strings.noNotifications}</p>
            </div>
            <span className="workspace-icon">
              <span className="codicon codicon-bell" aria-hidden="true" />
            </span>
          </article>
        )}
        {items.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            className={fresh.has(item.id) ? "notification fresh" : "notification"}
            onClick={() => {
              post({ type: "openNotification", projectId: item.projectId, messageId: item.messageId });
              onOpen();
            }}
          >
            <span className={`agent-icon ${item.kind === "order" ? "" : "accent"}`}>
              <span className={`codicon codicon-${ICONS[item.kind]}`} aria-hidden="true" />
            </span>
            <span className="notification-text">
              <span className="notification-head">
                <span className="person-name">{title(item)}</span>
                {fresh.has(item.id) && <span className="badge">{strings.newBadge}</span>}
              </span>
              <span className="notification-body">
                {item.kind === "order" ? item.text.split(" · ").slice(1).join(" · ") : item.text}
              </span>
              <span className="meta">
                {item.teamName} · {item.projectName} · {formatRelative(item.createdAt, locale)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** En-tête d'un écran secondaire : retour, puis le titre. */
export function ScreenHeader({
  title,
  strings,
  onBack,
}: {
  title: string;
  strings: ChatStrings;
  onBack(): void;
}) {
  return (
    <header className="header screen-header">
      <button
        type="button"
        className="icon-button"
        title={strings.back}
        aria-label={strings.back}
        onClick={onBack}
      >
        <span className="codicon codicon-arrow-left" aria-hidden="true" />
      </button>
      <h1 className="screen-title">{title}</h1>
    </header>
  );
}
