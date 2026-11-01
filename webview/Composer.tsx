import type { Attachment, Message } from "@br-ia/protocol";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionMode } from "../src/cook/executor";
import type { ChatMember, ChatStrings, ToWebview } from "../src/webviewMessages";
import { Attachments } from "./Attachments";
import { authorName } from "./format";
import { loadDraft, post, saveDraft } from "./vscodeApi";

interface Props {
  projectId: string;
  members: ChatMember[];
  myUserId: string;
  replyTo: Message | null;
  onCancelReply(): void;
  strings: ChatStrings;
  locale: string;
  /** Incrémenté par le parent quand l'envoi a réussi. */
  sentCount: number;
  permissionMode: PermissionMode;
}

const MODE_ICONS: Record<PermissionMode, string> = {
  manual: "shield",
  autoEdit: "edit",
  auto: "zap",
  plan: "checklist",
};

/** Ce que le cuisinier peut faire sur cette machine, choisi à côté du bouton d'envoi. */
function ModeMenu({ mode, strings }: { mode: PermissionMode; strings: ChatStrings }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Un clic ailleurs ou Échap referme le menu.
    const onMouseDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="mode-menu" ref={menu}>
      <button
        type="button"
        className="mode-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={strings.modeTitle}
        onClick={() => setOpen(!open)}
      >
        <span className={`codicon codicon-${MODE_ICONS[mode]}`} aria-hidden="true" />
        {strings.modes[mode]}
      </button>
      {open && (
        <div className="mode-popover" role="menu" aria-label={strings.modeTitle}>
          <div className="mode-popover-title">{strings.modeTitle}</div>
          {(Object.keys(MODE_ICONS) as PermissionMode[]).map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={item === mode}
              className={item === mode ? "mode-option active" : "mode-option"}
              onClick={() => {
                post({ type: "setPermissionMode", mode: item });
                setOpen(false);
              }}
            >
              <span className={`codicon codicon-${MODE_ICONS[item]}`} aria-hidden="true" />
              <span className="mode-option-text">
                <span className="mode-option-name">{strings.modes[item]}</span>
                <span className="meta">{strings.modeDetails[item]}</span>
              </span>
              {item === mode && <span className="codicon codicon-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const BRIA: ChatMember = {
  userId: "bria",
  displayName: "bria",
  role: "membre",
  online: true,
  lastSeenAt: null,
};

/** Mention en cours de saisie : « @Ali » juste avant le curseur. */
function mentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, cursor));
  return match ? { start: cursor - (match[2]?.length ?? 0) - 1, query: match[2] ?? "" } : null;
}

export function Composer(props: Props) {
  const { projectId, members, myUserId, replyTo, strings } = props;
  const [text, setText] = useState(() => loadDraft(projectId));
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [sending, setSending] = useState(false);
  /** Fichiers déjà envoyés au serveur, qui partiront avec le prochain message. */
  const [pending, setPending] = useState<Attachment[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Changement de projet : on reprend son brouillon.
  useEffect(() => {
    setText(loadDraft(projectId));
    setPending([]);
  }, [projectId]);

  useEffect(() => saveDraft(projectId, text), [projectId, text]);

  // Envoi réussi : on vide la zone. En cas d'échec, le brouillon reste.
  // biome-ignore lint/correctness/useExhaustiveDependencies: réagit seulement au compteur d'envois.
  useEffect(() => {
    if (props.sentCount === 0) return;
    setText("");
    setPending([]);
    setSending(false);
    props.onCancelReply();
  }, [props.sentCount]);

  useEffect(() => {
    if (replyTo) textarea.current?.focus();
  }, [replyTo]);

  // Hauteur ajustée au contenu, dans une limite raisonnable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recalcul à chaque changement de texte.
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [text]);

  const mention = mentionQuery(text, cursor);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    // L'agent serveur se mentionne comme un membre : « @bria ».
    const agent = BRIA.displayName.includes(query) ? [BRIA] : [];
    const people = members.filter(
      (member) => member.userId !== myUserId && member.displayName.toLowerCase().includes(query),
    );
    return [...agent, ...people].slice(0, 6);
  }, [mention, members, myUserId]);

  const insertMention = (member: ChatMember) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(cursor);
    const inserted = `@${member.displayName} `;
    setText(before + inserted + after);
    const position = before.length + inserted.length;
    requestAnimationFrame(() => {
      textarea.current?.setSelectionRange(position, position);
      setCursor(position);
    });
  };

  const send = () => {
    const typed = text.trim();
    if ((!typed && pending.length === 0) || sending) return;
    // Raccourcis « / » : une action locale, ou un message tout prêt pour l'agent serveur.
    const slash = typed.toLowerCase();
    if (slash === "/memoire" || slash === "/mémoire") {
      setText("");
      post({ type: "command", command: "openMemoryDocument" });
      return;
    }
    if (slash === "/terminal") {
      setText("");
      post({ type: "command", command: "showCookTerminal" });
      return;
    }
    const body = slash === "/statut" ? strings.quickStatusMessage : typed;
    // Mentions : les membres dont « @Nom » figure encore dans le texte.
    const mentions = members.filter((member) => body.includes(`@${member.displayName}`)).map((m) => m.userId);
    setSending(true);
    post({
      type: "send",
      body,
      replyToId: replyTo?.id,
      mentions,
      attachmentIds: pending.map((attachment) => attachment.id),
    });
  };

  // Échec de l'envoi : on permet de réessayer. Fichiers prêts : on les ajoute.
  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "sendResult" && !event.data.ok) setSending(false);
      if (event.data.type === "attached" && event.data.projectId === projectId) {
        const added = event.data.attachments;
        setPending((current) => [...current, ...added]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectId]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const member = suggestions[selected];
        if (member) insertMention(member);
        return;
      }
    }
    if (event.key === "Escape" && replyTo) {
      props.onCancelReply();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      {replyTo && (
        <div className="reply-bar">
          <span className="codicon codicon-reply" aria-hidden="true" />
          <span className="reply-bar-text">
            {strings.replyingTo.replace("{0}", authorName(replyTo.author, strings, myUserId))}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={props.onCancelReply}
            title={strings.cancelReply}
            aria-label={strings.cancelReply}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mentions" role="listbox" aria-label={strings.composerPlaceholder}>
          {suggestions.map((member, index) => (
            <button
              key={member.userId}
              type="button"
              role="option"
              aria-selected={index === selected}
              tabIndex={-1}
              className={index === selected ? "selected" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(member);
              }}
            >
              <span
                className={`codicon codicon-${member === BRIA ? "comment-discussion" : "account"}`}
                aria-hidden="true"
              />
              {member.displayName}
            </button>
          ))}
        </div>
      )}
      <Attachments
        attachments={pending}
        strings={strings}
        locale={props.locale}
        onRemove={(removed) => setPending((current) => current.filter((item) => item.id !== removed.id))}
      />
      <div className="quick-actions">
        <button
          type="button"
          className="chip-button"
          onClick={() => {
            setSending(true);
            post({ type: "send", body: strings.quickStatusMessage, mentions: [], attachmentIds: [] });
          }}
        >
          <span className="slash">/</span>
          {strings.quickStatus}
        </button>
        <button
          type="button"
          className="chip-button"
          onClick={() => post({ type: "command", command: "openMemoryDocument" })}
        >
          <span className="codicon codicon-markdown" aria-hidden="true" />
          {strings.quickMemory}
        </button>
        <button
          type="button"
          className="chip-button"
          onClick={() => post({ type: "command", command: "showCookTerminal" })}
        >
          <span className="codicon codicon-terminal" aria-hidden="true" />
          {strings.quickTerminal}
        </button>
      </div>
      <div className="input-box">
        <div className="input-area">
          <textarea
            ref={textarea}
            value={text}
            rows={1}
            placeholder={strings.composerPlaceholder}
            aria-label={strings.composerPlaceholder}
            onChange={(event) => {
              setText(event.target.value);
              setCursor(event.target.selectionStart);
              setSelected(0);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
          />
          {!text && (
            <span className="slash-hint" aria-hidden="true">
              /
            </span>
          )}
        </div>
        {/* Barre du bas, comme chez Claude : joindre à gauche ; le mode et l'envoi à droite. */}
        <div className="composer-toolbar">
          <button
            type="button"
            className="icon-button"
            onClick={() => post({ type: "attach", pending: pending.length })}
            title={strings.attach}
            aria-label={strings.attach}
          >
            <span className="codicon codicon-add" aria-hidden="true" />
          </button>
          <span className="spacer" />
          <ModeMenu mode={props.permissionMode} strings={strings} />
          <button
            type="button"
            className="send-button"
            onClick={send}
            disabled={(!text.trim() && pending.length === 0) || sending}
            title={strings.send}
            aria-label={strings.send}
          >
            <span className="codicon codicon-arrow-up" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="composer-hint">{strings.composerHint}</p>
    </div>
  );
}
