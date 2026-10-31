import type { Order } from "@br-ia/protocol";
import type { ChatMember, ChatStrings } from "../src/webviewMessages";
import { formatRelative } from "./format";
import { activeOrder, orderCode } from "./Orders";
import { post } from "./vscodeApi";

interface Props {
  teamName: string;
  projectName: string;
  members: ChatMember[];
  myUserId: string;
  isChef: boolean;
  connected: boolean;
  orders: Order[];
  folderLinked: boolean;
  strings: ChatStrings;
  locale: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Onglet Équipe : les membres, les agents IA et les actions de l'équipe. */
export function TeamTab(props: Props) {
  const { strings, locale } = props;
  const online = props.members.filter((member) => member.online).length;
  const current = activeOrder(props.orders);
  const cookStatus = current?.status === "running" ? "busy" : current ? "waiting" : "ready";

  return (
    <div className="tab-body">
      <article className="workspace-card">
        <div className="workspace-text">
          <div className="meta-label">{strings.workspace.replace("{0}", props.projectName)}</div>
          <h2 className="page-title">{strings.teamTitle.replace("{0}", props.teamName)}</h2>
          <div className="meta">
            {strings.teamStats.replace("{0}", String(props.members.length)).replace("{1}", "2")}
          </div>
        </div>
        <span className="workspace-icon">
          <span className="codicon codicon-organization" aria-hidden="true" />
        </span>
      </article>

      <div className="section-head small">
        <h3 className="subtitle">
          <span className="codicon codicon-person" aria-hidden="true" />
          {strings.teamMembers}
        </h3>
        <span className="meta">{strings.activeMembers.replace("{0}", String(online))}</span>
      </div>
      {props.members.map((member) => {
        const me = member.userId === props.myUserId;
        return (
          <article key={member.userId} className="person-row">
            <span className="person-avatar">
              {initials(member.displayName)}
              <span className={`presence ${member.online ? "on" : "off"}`} aria-hidden="true" />
            </span>
            <div className="person-text">
              <div className="person-name">
                {member.displayName}
                {me && <span className="badge">{strings.youBadge}</span>}
              </div>
              <div className="meta">{member.role === "chef" ? strings.roleChef : strings.roleMember}</div>
            </div>
            <span className={`pill status ${member.online ? "done" : "stopped"}`}>
              {member.online ? (
                <>
                  <span className="status-dot done" aria-hidden="true" />
                  {strings.onlineNow}
                </>
              ) : (
                <>
                  <span className="codicon codicon-history" aria-hidden="true" />
                  {member.lastSeenAt
                    ? strings.seenAgo.replace("{0}", formatRelative(member.lastSeenAt, locale))
                    : strings.neverSeen}
                </>
              )}
            </span>
          </article>
        );
      })}

      <div className="section-head small">
        <h3 className="subtitle">
          <span className="codicon codicon-hubot" aria-hidden="true" />
          {strings.aiAgents}
        </h3>
      </div>
      <article className="person-row">
        <span className="agent-icon accent">
          <span className="codicon codicon-comment-discussion" aria-hidden="true" />
        </span>
        <div className="person-text">
          <div className="person-name">br.ia · {strings.serveur}</div>
          <div className="meta">{strings.serveurRole}</div>
        </div>
        <span className={`pill status ${props.connected ? "done" : "stopped"}`}>
          <span className={`status-dot ${props.connected ? "done" : "stopped"}`} aria-hidden="true" />
          {props.connected ? strings.agentActive : strings.agentUnavailable}
        </span>
      </article>
      <article className="person-row">
        <span className="agent-icon">
          <span className="codicon codicon-tools" aria-hidden="true" />
        </span>
        <div className="person-text">
          <div className="person-name">br.ia · {strings.cuisinier}</div>
          <div className="meta">{strings.cuisinierRole}</div>
        </div>
        <span
          className={`pill status ${cookStatus === "busy" ? "running" : cookStatus === "waiting" ? "pending" : "done"}`}
        >
          {strings.cookStatus[cookStatus]}
          {current && ` (${orderCode(current)})`}
        </span>
      </article>

      <div className="button-row">
        {props.isChef && (
          <button
            type="button"
            className="primary-button"
            onClick={() => post({ type: "command", command: "invite" })}
          >
            <span className="codicon codicon-person-add" aria-hidden="true" />
            {strings.invite}
          </button>
        )}
        {!props.folderLinked && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => post({ type: "command", command: "linkFolder" })}
          >
            <span className="codicon codicon-folder" aria-hidden="true" />
            {strings.linkFolder}
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() => post({ type: "command", command: "toggleLending" })}
        >
          <span className="codicon codicon-vm-connect" aria-hidden="true" />
          {strings.lendMachine}
        </button>
      </div>
    </div>
  );
}
