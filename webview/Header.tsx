import type { ChatStrings } from "../src/webviewMessages";
import { post } from "./vscodeApi";

export type Tab = "chat" | "memory" | "orders" | "team";

/** Écran affiché par-dessus l'accueil ou le projet. */
export type Screen = "main" | "notifications" | "settings" | "vault";

interface HeaderProps {
  logoUri: string;
  section: string;
  teamName: string;
  onlineCount: number;
  memberCount: number;
  connected: boolean;
  unread: number;
  onScreen(screen: Screen): void;
  strings: ChatStrings;
}

/** En-tête : le logo, « <br/> / section », l'équipe et ses membres en ligne, puis les actions. */
export function Header(props: HeaderProps) {
  const { strings } = props;
  return (
    <header className="header">
      <div className="brand">
        <span className="avatar">
          <img src={props.logoUri} alt="<br/>" />
          <span className={`presence ${props.connected ? "on" : "off"}`} aria-hidden="true" />
        </span>
        <div className="brand-text">
          <div className="breadcrumb">
            <span className="brand-name">{"<br/>"}</span>
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
          title={strings.allProjects}
          aria-label={strings.allProjects}
          onClick={() => post({ type: "openProject", projectId: null })}
        >
          <span className="codicon codicon-home" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          title={strings.vaultTitle}
          aria-label={strings.vaultTitle}
          onClick={() => props.onScreen("vault")}
        >
          <span className="codicon codicon-lock" aria-hidden="true" />
        </button>
        <AccountActions unread={props.unread} onScreen={props.onScreen} strings={strings} />
      </div>
    </header>
  );
}

interface AccountActionsProps {
  unread: number;
  onScreen(screen: Screen): void;
  strings: ChatStrings;
}

/** Actualiser, les notifications (avec le nombre de non-lues) et les réglages. */
export function AccountActions({ unread, onScreen, strings }: AccountActionsProps) {
  return (
    <>
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
        className="icon-button bell"
        title={strings.notificationsTitle}
        aria-label={unread > 0 ? `${strings.notificationsTitle} (${unread})` : strings.notificationsTitle}
        onClick={() => onScreen("notifications")}
      >
        <span className={`codicon codicon-${unread > 0 ? "bell-dot" : "bell"}`} aria-hidden="true" />
        {unread > 0 && <span className="nav-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <button
        type="button"
        className="icon-button"
        title={strings.settingsTitle}
        aria-label={strings.settingsTitle}
        onClick={() => onScreen("settings")}
      >
        <span className="codicon codicon-settings-gear" aria-hidden="true" />
      </button>
    </>
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
    <nav className="bottom-nav" aria-label="<br/>">
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
