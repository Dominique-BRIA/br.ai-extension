import type { ChatStrings } from "../src/webviewMessages";
import { post } from "./vscodeApi";

export type Tab = "chat" | "memory" | "orders" | "team";

interface HeaderProps {
  logoUri: string;
  section: string;
  teamName: string;
  onlineCount: number;
  memberCount: number;
  connected: boolean;
  strings: ChatStrings;
}

/** En-tête : le logo, « br.ia / section », l'équipe et ses membres en ligne, puis les actions. */
export function Header(props: HeaderProps) {
  const { strings } = props;
  return (
    <header className="header">
      <div className="brand">
        <span className="avatar">
          <img src={props.logoUri} alt="br.ia" />
          <span className={`presence ${props.connected ? "on" : "off"}`} aria-hidden="true" />
        </span>
        <div className="brand-text">
          <div className="breadcrumb">
            <span className="brand-name">br.ia</span>
            <span className="slash" aria-hidden="true">
              /
            </span>
            <span className="section">{props.section}</span>
            {props.connected && <span className="pill online-pill">{strings.online_pill}</span>}
          </div>
          <div className="brand-team">
            <span className="codicon codicon-organization" aria-hidden="true" />
            <span className="team-name">{props.teamName}</span>
            <span className="separator" aria-hidden="true">
              ·
            </span>
            <span className="online">
              {strings.online
                .replace("{0}", String(props.onlineCount))
                .replace("{1}", String(props.memberCount))}
            </span>
          </div>
        </div>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="icon-button"
          title={strings.refresh}
          aria-label={strings.refresh}
          onClick={() => post({ type: "refresh" })}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          title={strings.more}
          aria-label={strings.more}
          onClick={() => post({ type: "command", command: "menu" })}
        >
          <span className="codicon codicon-kebab-vertical" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

interface NavProps {
  tab: Tab;
  onTab(tab: Tab): void;
  openMemory: number;
  /** Pastille des Commandes : une commande attend ou est en cours. */
  ordersSignal: "pending" | "running" | null;
  strings: ChatStrings;
}

/** Navigation en bas du panneau : Chat, Mémoire, Commandes, Équipe. */
export function BottomNav({ tab, onTab, openMemory, ordersSignal, strings }: NavProps) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: "chat", label: strings.tabChat, icon: "comment-discussion" },
    { id: "memory", label: strings.tabMemory, icon: "book" },
    { id: "orders", label: strings.tabOrders, icon: "terminal" },
    { id: "team", label: strings.tabTeam, icon: "organization" },
  ];
  return (
    <nav className="bottom-nav" aria-label="br.ia">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={tab === item.id ? "nav-item active" : "nav-item"}
          aria-current={tab === item.id ? "page" : undefined}
          onClick={() => onTab(item.id)}
        >
          <span className="nav-icon">
            <span className={`codicon codicon-${item.icon}`} aria-hidden="true" />
            {item.id === "memory" && openMemory > 0 && <span className="nav-count">{openMemory}</span>}
            {item.id === "orders" && ordersSignal && (
              <span className={`nav-dot ${ordersSignal}`} aria-hidden="true" />
            )}
          </span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
