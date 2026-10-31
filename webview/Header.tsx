import type { ChatStrings } from "../src/webviewMessages";
import { post } from "./vscodeApi";

export type Tab = "chat" | "memory" | "orders";

interface Props {
  logoUri: string;
  teamName: string;
  onlineCount: number;
  memberCount: number;
  connected: boolean;
  tab: Tab;
  onTab(tab: Tab): void;
  openMemory: number;
  /** Couleur de la pastille de l'onglet Commandes : une commande attend ou est en cours. */
  ordersSignal: "pending" | "running" | null;
  strings: ChatStrings;
}

/** En-tête du panneau : logo, équipe, membres en ligne, actions, puis les trois onglets. */
export function Header(props: Props) {
  const { strings } = props;
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "chat", label: strings.tabChat, icon: "comment-discussion" },
    { id: "memory", label: strings.tabMemory, icon: "book" },
    { id: "orders", label: strings.tabOrders, icon: "tools" },
  ];
  return (
    <header className="header">
      <div className="header-top">
        <div className="brand">
          <span className="avatar">
            <img src={props.logoUri} alt="" />
            <span className={`presence ${props.connected ? "on" : "off"}`} aria-hidden="true" />
          </span>
          <div className="brand-text">
            <div className="brand-title">
              <span className="brand-name">br.ia</span>
              <span className="badge">{strings.beta}</span>
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
            <span className="codicon codicon-ellipsis" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.tab === tab.id}
            className={props.tab === tab.id ? "tab active" : "tab"}
            onClick={() => props.onTab(tab.id)}
          >
            <span className={`codicon codicon-${tab.icon}`} aria-hidden="true" />
            <span>{tab.label}</span>
            {tab.id === "memory" && props.openMemory > 0 && <span className="count">{props.openMemory}</span>}
            {tab.id === "orders" && props.ordersSignal && (
              <span className={`dot ${props.ordersSignal}`} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </header>
  );
}
