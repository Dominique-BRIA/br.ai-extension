import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChatStrings, HomeForm, HomeTeam, ToWebview } from "../src/webviewMessages";
import { initials } from "./format";
import { post } from "./vscodeApi";

interface Props {
  user: { displayName: string; email: string };
  teams: HomeTeam[] | null;
  logoUri: string;
  connected: boolean;
  strings: ChatStrings;
}

/** Accueil : les équipes et leurs projets, la création ou l'arrivée dans une équipe, et le compte. */
export function Home({ user, teams, logoUri, connected, strings }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="panel-root">
      <header className="header">
        <div className="brand">
          <span className="avatar">
            <img src={logoUri} alt="" />
            <span className={`presence ${connected ? "on" : "off"}`} aria-hidden="true" />
          </span>
          <div className="brand-text">
            <div className="breadcrumb">
              <span className="brand-name">{"<br>.ia"}</span>
              {connected && <span className="pill online-pill">{strings.online_pill}</span>}
            </div>
            <div className="brand-team">{strings.allProjects}</div>
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
        </div>
      </header>

      <div className="tab-body">
        <h1 className="page-title">{strings.homeGreeting.replace("{0}", user.displayName)}</h1>
        <p className="page-subtitle">{strings.homeIntro}</p>

        {teams === null && <p className="empty-text home-loading">{strings.loading}</p>}

        {teams?.length === 0 && (
          <article className="workspace-card onboarding">
            <div className="workspace-text">
              <h2 className="section-title">{strings.noTeamsTitle}</h2>
              <p className="meta">{strings.noTeamsBody}</p>
            </div>
            <span className="workspace-icon">
              <span className="codicon codicon-rocket" aria-hidden="true" />
            </span>
          </article>
        )}

        {teams && teams.length > 0 && (
          <div className="section-head small">
            <h3 className="subtitle">
              <span className="codicon codicon-organization" aria-hidden="true" />
              {strings.yourTeams}
            </h3>
          </div>
        )}

        {teams?.map((team) => (
          <article key={team.id} className="team-card">
            <div className="team-card-head">
              <span className="person-avatar">{initials(team.name)}</span>
              <div className="person-text">
                <div className="person-name">
                  {team.name}
                  {team.isChef && <span className="badge">{strings.roleChef}</span>}
                </div>
                <div className="meta">
                  {strings.online
                    .replace("{0}", String(team.onlineCount))
                    .replace("{1}", String(team.memberCount))}{" "}
                  · {strings.projectCount.replace("{0}", String(team.projects.length))}
                </div>
              </div>
            </div>

            {team.projects.length === 0 && <p className="empty-text">{strings.noProjects}</p>}
            {team.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="project-row"
                onClick={() => post({ type: "openProject", projectId: project.id })}
              >
                <span className="codicon codicon-comment-discussion" aria-hidden="true" />
                <span className="project-name">{project.name}</span>
                <span className="codicon codicon-chevron-right" aria-hidden="true" />
              </button>
            ))}

            {open === `project:${team.id}` ? (
              <InlineForm
                form="createProject"
                icon="new-file"
                placeholder={strings.projectNamePlaceholder}
                submit={strings.create}
                strings={strings}
                onSubmit={(name) => post({ type: "createProject", teamId: team.id, name })}
                onClose={() => setOpen(null)}
              />
            ) : (
              <button
                type="button"
                className="ghost-button add-row"
                onClick={() => setOpen(`project:${team.id}`)}
              >
                <span className="codicon codicon-add" aria-hidden="true" />
                {strings.newProject}
              </button>
            )}
          </article>
        ))}

        {teams && (
          <div className="home-actions">
            {open === "createTeam" ? (
              <InlineForm
                form="createTeam"
                icon="organization"
                placeholder={strings.teamNamePlaceholder}
                submit={strings.create}
                strings={strings}
                onSubmit={(name) => post({ type: "createTeam", name })}
                onClose={() => setOpen(null)}
              />
            ) : open === "joinTeam" ? (
              <InlineForm
                form="joinTeam"
                icon="key"
                placeholder={strings.teamKeyPlaceholder}
                submit={strings.join}
                mono
                strings={strings}
                onSubmit={(code) => post({ type: "joinTeam", code })}
                onClose={() => setOpen(null)}
              />
            ) : (
              <div className="button-row">
                <button type="button" className="primary-button" onClick={() => setOpen("createTeam")}>
                  <span className="codicon codicon-add" aria-hidden="true" />
                  {strings.createTeam}
                </button>
                <button type="button" className="secondary-button" onClick={() => setOpen("joinTeam")}>
                  <span className="codicon codicon-key" aria-hidden="true" />
                  {strings.joinTeam}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="section-head small">
          <h3 className="subtitle">
            <span className="codicon codicon-account" aria-hidden="true" />
            {strings.account}
          </h3>
        </div>
        <article className="team-card">
          <div className="team-card-head">
            <span className="person-avatar">{initials(user.displayName)}</span>
            <div className="person-text">
              <div className="person-name">{user.displayName}</div>
              <div className="meta">{user.email}</div>
            </div>
          </div>
          <div className="order-item-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => post({ type: "command", command: "editProfile" })}
            >
              <span className="codicon codicon-edit" aria-hidden="true" />
              {strings.editProfile}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => post({ type: "command", command: "manageMachines" })}
            >
              <span className="codicon codicon-vm" aria-hidden="true" />
              {strings.machines}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => post({ type: "command", command: "signOut" })}
            >
              <span className="codicon codicon-sign-out" aria-hidden="true" />
              {strings.signOut}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

interface FormProps {
  form: HomeForm;
  icon: string;
  placeholder: string;
  submit: string;
  mono?: boolean;
  strings: ChatStrings;
  onSubmit(value: string): void;
  onClose(): void;
}

/** Petit formulaire en ligne : un champ, valider, annuler ; l'erreur du serveur s'affiche dessous. */
function InlineForm({ form, icon, placeholder, submit, mono, strings, onSubmit, onClose }: FormProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Le formulaire s'ouvre sur demande : le curseur va directement dans son champ.
  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type !== "formResult" || message.form !== form) return;
      setBusy(false);
      if (message.ok) onClose();
      else setError(message.error ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [form, onClose]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    onSubmit(value.trim());
  };

  return (
    <form className="inline-form" onSubmit={send}>
      <span className="field-box">
        <span className={`codicon codicon-${icon}`} aria-hidden="true" />
        <input
          ref={input}
          className={mono ? "mono" : undefined}
          placeholder={placeholder}
          aria-label={placeholder}
          value={value}
          onChange={(event) => setValue(mono ? event.target.value.toUpperCase() : event.target.value)}
        />
      </span>
      {error && (
        <p className="auth-error" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
          {submit}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          {strings.cancel}
        </button>
      </div>
    </form>
  );
}
