import type { Order, ProjectRepo, SecretsResponse, TeamUsage } from "@br-ia/protocol";
import { useEffect, useState } from "react";
import type { ChatMember, ChatStrings, TeamInvitation } from "../src/webviewMessages";
import { formatRelative, initials } from "./format";
import { activeOrder, orderCode } from "./Orders";
import { UsageCard } from "./Usage";
import { VaultSection } from "./Vault";
import { post } from "./vscodeApi";

interface Props {
  teamName: string;
  projectName: string;
  chefName: string;
  members: ChatMember[];
  myUserId: string;
  isChef: boolean;
  /** Clé d'invitation en cours (chef) ; `undefined` tant qu'elle n'est pas chargée. */
  invitation: TeamInvitation | null | undefined;
  /** Formule et consommation ; `undefined` tant qu'elles ne sont pas chargées. */
  usage: TeamUsage | undefined;
  /** Coffre de secrets ; `undefined` tant qu'il n'est pas chargé. */
  vault: SecretsResponse | undefined;
  connected: boolean;
  orders: Order[];
  folderLinked: boolean;
  repo: ProjectRepo | null;
  strings: ChatStrings;
  locale: string;
}

/** Onglet Équipe : la clé d'invitation, les membres, les agents IA et les actions de l'équipe. */
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

      <UsageCard usage={props.usage} isChef={props.isChef} strings={strings} locale={locale} />

      <InvitationCard
        isChef={props.isChef}
        invitation={props.invitation}
        teamName={props.teamName}
        chefName={props.chefName}
        strings={strings}
        locale={locale}
      />

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
            {props.isChef && !me && (
              <span className="memory-actions">
                <button
                  type="button"
                  className="icon-button"
                  title={strings.makeChef}
                  aria-label={`${strings.makeChef} : ${member.displayName}`}
                  onClick={() => post({ type: "memberAction", userId: member.userId, action: "transfer" })}
                >
                  <span className="codicon codicon-star-empty" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={strings.removeMember}
                  aria-label={`${strings.removeMember} : ${member.displayName}`}
                  onClick={() => post({ type: "memberAction", userId: member.userId, action: "remove" })}
                >
                  <span className="codicon codicon-close" aria-hidden="true" />
                </button>
              </span>
            )}
          </article>
        );
      })}

      <div className="section-head small">
        <h3 className="subtitle">{strings.repoTitle}</h3>
      </div>
      <article className="person-row">
        <span className="codicon codicon-github" aria-hidden="true" />
        <div className="person-text">
          {props.repo ? (
            <>
              <div className="person-name">{props.repo.fullName}</div>
              <div className="meta">{props.repo.defaultBranch}</div>
            </>
          ) : (
            <div className="meta">{strings.repoNone}</div>
          )}
        </div>
      </article>
      {(props.isChef || (props.repo && !props.folderLinked)) && (
        <div className="button-row">
          {props.repo && !props.folderLinked && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => post({ type: "command", command: "cloneRepo" })}
            >
              <span className="codicon codicon-repo-clone" aria-hidden="true" />
              {strings.cloneRepo}
            </button>
          )}
          {props.isChef && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => post({ type: "command", command: "linkRepo" })}
            >
              <span className="codicon codicon-github" aria-hidden="true" />
              {props.repo ? strings.changeRepo : strings.linkRepo}
            </button>
          )}
        </div>
      )}

      <VaultSection
        vault={props.vault}
        members={props.members}
        isChef={props.isChef}
        folderLinked={props.folderLinked}
        strings={strings}
        locale={locale}
      />

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
          <div className="person-name">
            {"<br/>"} · {strings.serveur}
          </div>
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
          <div className="person-name">
            {"<br/>"} · {strings.cuisinier}
          </div>
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
      {!props.isChef && (
        <button
          type="button"
          className="ghost-button danger leave"
          onClick={() => post({ type: "command", command: "leaveTeam" })}
        >
          <span className="codicon codicon-sign-out" aria-hidden="true" />
          {strings.leaveTeam}
        </button>
      )}
    </div>
  );
}

interface CardProps {
  isChef: boolean;
  invitation: TeamInvitation | null | undefined;
  teamName: string;
  chefName: string;
  strings: ChatStrings;
  locale: string;
}

/** La clé à transmettre pour inviter : affichée et copiable par le chef, demandée au chef par les autres. */
function InvitationCard({ isChef, invitation, teamName, chefName, strings, locale }: CardProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isChef && invitation === undefined) post({ type: "invitation", action: "load" });
  }, [isChef, invitation]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!isChef) {
    return (
      <article className="invite-card">
        <div className="invite-head">
          <span className="codicon codicon-key" aria-hidden="true" />
          {strings.inviteKeyTitle}
        </div>
        <p className="meta">{strings.inviteKeyMember.replace("{0}", chefName)}</p>
      </article>
    );
  }

  return (
    <article className="invite-card">
      <div className="invite-head">
        <span className="codicon codicon-key" aria-hidden="true" />
        {strings.inviteKeyTitle}
      </div>
      {invitation === undefined && <p className="meta">{strings.loading}</p>}
      {invitation === null && <p className="meta">{strings.inviteKeyNone}</p>}
      {invitation && (
        <>
          <p className="meta">{strings.inviteKeyIntro.replace("{0}", teamName)}</p>
          <div className="invite-code">
            <code>{invitation.code}</code>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                post({ type: "copy", text: invitation.code });
                setCopied(true);
              }}
            >
              <span className={`codicon codicon-${copied ? "check" : "copy"}`} aria-hidden="true" />
              {copied ? strings.copied : strings.copy}
            </button>
          </div>
          <p className="meta">
            {strings.validUntil.replace(
              "{0}",
              new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(invitation.expiresAt)),
            )}
          </p>
        </>
      )}
      {invitation !== undefined && (
        <button
          type="button"
          className={invitation ? "ghost-button" : "primary-button wide"}
          onClick={() => post({ type: "invitation", action: "create" })}
        >
          <span className="codicon codicon-person-add" aria-hidden="true" />
          {invitation ? strings.newKey : strings.generateKey}
        </button>
      )}
    </article>
  );
}
