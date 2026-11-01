import type { Locale, MachineSession } from "@br-ia/protocol";
import { type FormEvent, useEffect, useState } from "react";
import type { PermissionMode } from "../src/cook/executor";
import type { ChatStrings, PanelSettings, ToWebview } from "../src/webviewMessages";
import { formatRelative } from "./format";
import { ScreenHeader } from "./Notifications";
import { post } from "./vscodeApi";

interface Props {
  settings: PanelSettings;
  strings: ChatStrings;
  locale: string;
  onBack(): void;
}

const MODES: PermissionMode[] = ["manual", "autoEdit", "auto", "plan"];

/** Les réglages du compte et de cette machine, sans quitter le panneau. */
export function Settings({ settings, strings, locale, onBack }: Props) {
  const [name, setName] = useState(settings.displayName);
  const [server, setServer] = useState(settings.serverUrl);
  const [machines, setMachines] = useState<MachineSession[] | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "machines") setMachines(event.data.machines);
    };
    window.addEventListener("message", onMessage);
    post({ type: "loadMachines" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!savedField) return;
    const timer = setTimeout(() => setSavedField(null), 2000);
    return () => clearTimeout(timer);
  }, [savedField]);

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.trim() === settings.displayName) return;
    post({ type: "updateProfile", displayName: name.trim() });
    setSavedField("name");
  };

  const saveServer = (event: FormEvent) => {
    event.preventDefault();
    if (server.trim() === settings.serverUrl) return;
    post({ type: "setServerUrl", url: server });
    setSavedField("server");
  };

  const toggle = (
    key: "lendMachine" | "showCookTerminal" | "notifyMentions",
    label: string,
    detail?: string,
  ) => (
    <label className="setting-row">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {detail && <span className="meta">{detail}</span>}
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={settings[key]}
        onChange={(event) => post({ type: "setSetting", key, value: event.target.checked })}
      />
    </label>
  );

  const savedLabel = (field: string) =>
    savedField === field && (
      <span className="saved" role="status">
        <span className="codicon codicon-check" aria-hidden="true" />
        {strings.saved}
      </span>
    );

  return (
    <div className="panel-root">
      <ScreenHeader title={strings.settingsTitle} strings={strings} onBack={onBack} />
      <div className="tab-body">
        <Section icon="account" title={strings.profileSection}>
          <form className="setting-form" onSubmit={saveName}>
            <label className="field">
              <span className="field-label">{strings.nameLabel}</span>
              <span className="field-box">
                <span className="codicon codicon-person" aria-hidden="true" />
                <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
              </span>
            </label>
            <div className="setting-actions">
              {savedLabel("name")}
              <button
                type="submit"
                className="secondary-button"
                disabled={name.trim() === settings.displayName}
              >
                {strings.save}
              </button>
            </div>
          </form>
          <EmailChange email={settings.email} strings={strings} />
          <div className="setting-row">
            <span className="setting-label">{strings.emailLanguage}</span>
            <fieldset className="segmented" aria-label={strings.emailLanguage}>
              {(["fr", "en"] as Locale[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={settings.locale === item}
                  className={settings.locale === item ? "active" : ""}
                  onClick={() => post({ type: "updateProfile", locale: item })}
                >
                  {item === "fr" ? "Français" : "English"}
                </button>
              ))}
            </fieldset>
          </div>
        </Section>

        <Section icon="vm" title={strings.machineSection}>
          <span className="setting-label">{strings.modeTitle}</span>
          <fieldset className="mode-list" aria-label={strings.modeTitle}>
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={settings.permissionMode === mode}
                className={settings.permissionMode === mode ? "mode-option active" : "mode-option"}
                onClick={() => post({ type: "setPermissionMode", mode })}
              >
                <span
                  className={`codicon codicon-${settings.permissionMode === mode ? "pass-filled" : "circle-large-outline"}`}
                  aria-hidden="true"
                />
                <span className="mode-option-text">
                  <span className="mode-option-name">{strings.modes[mode]}</span>
                  <span className="meta">{strings.modeDetails[mode]}</span>
                </span>
              </button>
            ))}
          </fieldset>
          {toggle("lendMachine", strings.lendMachine, strings.lendMachineDetail)}
          {toggle("showCookTerminal", strings.showTerminalLabel)}
          {toggle("notifyMentions", strings.notifyLabel)}
        </Section>

        <Section icon="book" title={strings.localMemorySection}>
          <p className="meta">{strings.localMemoryDetail}</p>
          <button type="button" className="document-row" onClick={() => post({ type: "openLocalMemory" })}>
            <span className="document-icon">
              <span className="codicon codicon-markdown" aria-hidden="true" />
            </span>
            <span className="document-text">
              <span className="document-name">{settings.localMemoryFile}</span>
            </span>
            <span className="codicon codicon-go-to-file" aria-hidden="true" />
          </button>
        </Section>

        <Section icon="device-desktop" title={strings.machinesSection}>
          {machines === null && <p className="meta">{strings.loading}</p>}
          {machines?.map((machine) => (
            <article key={machine.id} className="person-row">
              <span className="agent-icon accent">
                <span
                  className={`codicon codicon-${machine.os === "macos" ? "device-desktop" : "vm"}`}
                  aria-hidden="true"
                />
              </span>
              <div className="person-text">
                <div className="person-name">
                  {[machine.os, machine.editor].filter(Boolean).join(" · ")}
                  {machine.current && <span className="badge">{strings.thisMachine}</span>}
                </div>
                <div className="meta">
                  {machine.online
                    ? strings.onlineNow
                    : strings.seenAgo.replace("{0}", formatRelative(machine.lastSeenAt, locale))}
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                title={strings.signOut}
                aria-label={strings.signOut}
                onClick={() => post({ type: "signOutMachine", sessionId: machine.id })}
              >
                <span className="codicon codicon-sign-out" aria-hidden="true" />
              </button>
            </article>
          ))}
        </Section>

        <Section icon="feedback" title={strings.feedbackTitle}>
          <FeedbackForm strings={strings} />
        </Section>

        <Section icon="server" title={strings.serverSection}>
          <form className="setting-form" onSubmit={saveServer}>
            <label className="field">
              <span className="field-label">{strings.serverUrlLabel}</span>
              <span className="field-box">
                <span className="codicon codicon-globe" aria-hidden="true" />
                <input className="mono" value={server} onChange={(event) => setServer(event.target.value)} />
              </span>
            </label>
            <div className="setting-actions">
              {savedLabel("server")}
              <button
                type="submit"
                className="secondary-button"
                disabled={server.trim() === settings.serverUrl}
              >
                {strings.save}
              </button>
            </div>
          </form>
        </Section>

        <Section icon="account" title={strings.account}>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => post({ type: "command", command: "signOut" })}
            >
              <span className="codicon codicon-sign-out" aria-hidden="true" />
              {strings.signOut}
            </button>
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => post({ type: "command", command: "deleteAccount" })}
            >
              <span className="codicon codicon-trash" aria-hidden="true" />
              {strings.deleteAccount}
            </button>
          </div>
        </Section>

        <p className="meta version">{strings.version.replace("{0}", settings.version)}</p>
      </div>
    </div>
  );
}

/**
 * L'adresse e-mail du compte et son changement : un code part vers la nouvelle adresse,
 * qui ne remplace l'ancienne qu'une fois ce code saisi. Le code peut être renvoyé.
 */
function EmailChange({ email, strings }: { email: string; strings: ChatStrings }) {
  const [step, setStep] = useState<"idle" | "email" | "code">("idle");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type !== "emailResult") return;
      setBusy(false);
      if (message.ok) {
        setError(null);
        if (message.step === "request") {
          setStep("code");
        } else {
          setStep("idle");
          setCode("");
          setNotice(strings.emailChanged);
        }
        return;
      }
      setError(
        message.error === "email_taken"
          ? strings.emailTaken
          : message.error === "code_invalid"
            ? strings.codeInvalid
            : message.error === "too_many_requests"
              ? strings.codeAlreadySent
              : (message.message ?? strings.serverUnreachable),
      );
      // Un code est déjà parti il y a moins d'une minute : on passe quand même à sa saisie.
      if (message.step === "request" && message.error === "too_many_requests") setStep("code");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [strings]);

  const request = () => {
    if (!/^\S+@\S+\.\S+$/.test(next.trim())) {
      setError(strings.invalidEmail);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    post({ type: "changeEmail", email: next.trim() });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step === "email") request();
    else if (/^\d{6}$/.test(code)) {
      setBusy(true);
      post({ type: "verifyEmail", email: next.trim(), code });
    }
  };

  const cancel = () => {
    setStep("idle");
    setNext("");
    setCode("");
    setError(null);
  };

  if (step === "idle") {
    return (
      <div className="setting-row">
        <span className="setting-text">
          <span className="setting-label">{strings.emailLabel}</span>
          <span className="meta">{email}</span>
          {notice && <span className="saved">{notice}</span>}
        </span>
        <button type="button" className="secondary-button" onClick={() => setStep("email")}>
          {strings.editEmail}
        </button>
      </div>
    );
  }

  return (
    <form className="setting-form email-change" onSubmit={submit}>
      {step === "email" ? (
        <label className="field">
          <span className="field-label">{strings.newEmailLabel}</span>
          <span className="field-box">
            <span className="codicon codicon-mail" aria-hidden="true" />
            <input
              type="email"
              autoComplete="email"
              placeholder={strings.emailPlaceholder}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </span>
        </label>
      ) : (
        <label className="field">
          <span className="field-label">{strings.emailCodeIntro.replace("{0}", next.trim())}</span>
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>
      )}
      {error && (
        <p className="auth-error" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="setting-actions">
        {step === "code" && (
          <button type="button" className="link" disabled={busy} onClick={request}>
            {strings.resendCode}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="secondary-button" onClick={cancel}>
          {strings.cancel}
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
          {step === "email" ? strings.sendCode : strings.confirm}
        </button>
      </div>
    </form>
  );
}

/** Un retour de testeur : il arrive dans le tableau de bord d'administration. */
function FeedbackForm({ strings }: { strings: ChatStrings }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type !== "formResult" || message.form !== "feedback") return;
      setBusy(false);
      if (message.ok) {
        setText("");
        setSent(true);
      } else {
        setError(message.error ?? null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setSent(false);
    setError(null);
    post({ type: "sendFeedback", text: text.trim() });
  };

  return (
    <form className="setting-form" onSubmit={submit}>
      <textarea
        className="feedback-text"
        rows={4}
        maxLength={5000}
        placeholder={strings.feedbackPlaceholder}
        aria-label={strings.feedbackTitle}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {error && (
        <p className="auth-error" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="setting-actions">
        {sent && (
          <span className="saved" role="status">
            <span className="codicon codicon-check" aria-hidden="true" />
            {strings.feedbackThanks}
          </span>
        )}
        <button type="submit" className="primary-button" disabled={busy || !text.trim()}>
          {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
          {strings.feedbackSend}
        </button>
      </div>
    </form>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="subtitle">
        <span className={`codicon codicon-${icon}`} aria-hidden="true" />
        {title}
      </h2>
      <div className="team-card">{children}</div>
    </section>
  );
}
