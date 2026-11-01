import type { ProjectSecret, SecretLogResponse, SecretsResponse } from "@br-ia/protocol";
import { type FormEvent, useEffect, useState } from "react";
import type { ChatMember, ChatStrings, HomeForm, ToWebview } from "../src/webviewMessages";
import { formatRelative } from "./format";
import { post } from "./vscodeApi";

interface Props {
  vault: SecretsResponse | undefined;
  members: ChatMember[];
  isChef: boolean;
  folderLinked: boolean;
  strings: ChatStrings;
  locale: string;
}

/**
 * Le coffre de secrets du projet. Le chef dépose les secrets et choisit qui peut les
 * récupérer ; chacun écrit le .env de sa machine avec ceux qui lui sont ouverts.
 */
export function VaultSection({ vault, members, isChef, folderLinked, strings, locale }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [log, setLog] = useState<SecretLogResponse["entries"] | null>(null);

  useEffect(() => {
    if (vault === undefined) post({ type: "vault", action: "load" });
  }, [vault]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "secretLog") setLog(event.data.entries);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Le chef a toujours accès ; on choisit parmi les autres membres.
  const others = members.filter((member) => member.role !== "chef");
  const accessText = (secret: ProjectSecret) => {
    const names = others
      .filter((member) => secret.access.includes(member.userId))
      .map((member) => member.displayName);
    return strings.accessLabel.replace("{0}", names.length > 0 ? names.join(", ") : strings.chefOnly);
  };

  return (
    <section>
      <div className="section-head small">
        <h3 className="subtitle">
          <span className="codicon codicon-lock" aria-hidden="true" />
          {strings.vaultTitle}
        </h3>
        {isChef && vault?.enabled && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (log) setLog(null);
              else post({ type: "vault", action: "log" });
            }}
          >
            <span className="codicon codicon-history" aria-hidden="true" />
            {strings.vaultLog}
          </button>
        )}
      </div>

      {vault === undefined && <p className="meta">{strings.loading}</p>}
      {vault && !vault.enabled && <p className="meta">{strings.vaultDisabled}</p>}

      {vault?.enabled && (
        <>
          {vault.secrets.length === 0 && (
            <p className="meta">{isChef ? strings.vaultEmpty : strings.vaultNoneForYou}</p>
          )}
          {vault.secrets.map((secret) =>
            editing === secret.id ? (
              <SecretForm
                key={secret.id}
                form="updateSecret"
                secret={secret}
                members={others}
                strings={strings}
                onClose={() => setEditing(null)}
              />
            ) : (
              <article key={secret.id} className="person-row">
                <span className="agent-icon accent">
                  <span className="codicon codicon-key" aria-hidden="true" />
                </span>
                <div className="person-text">
                  <div className="person-name mono">{secret.name}</div>
                  <div className="meta">
                    {isChef ? `${accessText(secret)} · ` : ""}
                    {formatRelative(secret.updatedAt, locale)}
                  </div>
                </div>
                {isChef && (
                  <span className="memory-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title={strings.edit}
                      aria-label={`${strings.edit} ${secret.name}`}
                      onClick={() => setEditing(secret.id)}
                    >
                      <span className="codicon codicon-edit" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title={strings.remove}
                      aria-label={`${strings.remove} ${secret.name}`}
                      onClick={() => post({ type: "deleteSecret", id: secret.id })}
                    >
                      <span className="codicon codicon-trash" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </article>
            ),
          )}

          {isChef &&
            (editing === "new" ? (
              <SecretForm
                form="createSecret"
                members={others}
                strings={strings}
                onClose={() => setEditing(null)}
              />
            ) : (
              <button type="button" className="ghost-button add-row" onClick={() => setEditing("new")}>
                <span className="codicon codicon-add" aria-hidden="true" />
                {strings.addSecret}
              </button>
            ))}

          {vault.secrets.length > 0 &&
            (folderLinked ? (
              <button
                type="button"
                className="secondary-button wide env-button"
                onClick={() => post({ type: "vault", action: "writeEnv" })}
              >
                <span className="codicon codicon-file-symlink-file" aria-hidden="true" />
                {strings.writeEnv}
              </button>
            ) : (
              <p className="meta">{strings.envNeedsFolder}</p>
            ))}

          {log && (
            <ol className="steps vault-log">
              {log.map((entry) => (
                <li key={entry.id}>
                  <span className="codicon codicon-key" aria-hidden="true" />
                  <span className="step-text">
                    {entry.userName} · {strings.logActions[entry.action]} ·{" "}
                    <span className="mono">{entry.secretName}</span>
                  </span>
                  <time dateTime={entry.createdAt}>{formatRelative(entry.createdAt, locale)}</time>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

interface FormProps {
  form: Extract<HomeForm, "createSecret" | "updateSecret">;
  secret?: ProjectSecret;
  members: ChatMember[];
  strings: ChatStrings;
  onClose(): void;
}

/** Ajout ou modification d'un secret : la valeur ne revient jamais dans le panneau. */
function SecretForm({ form, secret, members, strings, onClose }: FormProps) {
  const [name, setName] = useState(secret?.name ?? "");
  const [value, setValue] = useState("");
  const [access, setAccess] = useState<string[]>(secret?.access ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (form === "createSecret") {
      if (!name.trim() || !value) return;
      post({ type: "createSecret", name: name.trim(), value, access });
    } else if (secret) {
      post({ type: "updateSecret", id: secret.id, value: value || undefined, access });
    }
    setBusy(true);
    setError(null);
  };

  return (
    <form className="inline-form team-card" onSubmit={submit}>
      {form === "createSecret" ? (
        <label className="field">
          <span className="field-label">{strings.secretName}</span>
          <span className="field-box">
            <span className="codicon codicon-symbol-constant" aria-hidden="true" />
            <input
              className="mono"
              placeholder="DATABASE_URL"
              value={name}
              onChange={(event) => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            />
          </span>
        </label>
      ) : (
        <div className="person-name mono">{secret?.name}</div>
      )}
      <label className="field">
        <span className="field-label">{strings.secretValue}</span>
        <span className="field-box">
          <span className="codicon codicon-key" aria-hidden="true" />
          <input
            type="password"
            autoComplete="off"
            placeholder={form === "updateSecret" ? strings.newValuePlaceholder : ""}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </span>
      </label>
      {members.length > 0 && (
        <fieldset className="access-list">
          <legend className="field-label">{strings.whoHasAccess}</legend>
          {members.map((member) => (
            <label key={member.userId} className="check-row">
              <input
                type="checkbox"
                checked={access.includes(member.userId)}
                onChange={(event) =>
                  setAccess((current) =>
                    event.target.checked
                      ? [...current, member.userId]
                      : current.filter((id) => id !== member.userId),
                  )
                }
              />
              {member.displayName}
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="auth-error" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
          {strings.save}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          {strings.cancel}
        </button>
      </div>
    </form>
  );
}
