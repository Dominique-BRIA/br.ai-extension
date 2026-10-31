import type { Message } from "@br-ia/protocol";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMember, ChatStrings } from "../src/webviewMessages";
import { authorName } from "./format";
import { loadDraft, post, saveDraft } from "./vscodeApi";

interface Props {
  projectId: string;
  members: ChatMember[];
  myUserId: string;
  replyTo: Message | null;
  onCancelReply(): void;
  strings: ChatStrings;
  /** Incrémenté par le parent quand l'envoi a réussi. */
  sentCount: number;
}

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
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Changement de projet : on reprend son brouillon.
  useEffect(() => {
    setText(loadDraft(projectId));
  }, [projectId]);

  useEffect(() => saveDraft(projectId, text), [projectId, text]);

  // Envoi réussi : on vide la zone. En cas d'échec, le brouillon reste.
  // biome-ignore lint/correctness/useExhaustiveDependencies: réagit seulement au compteur d'envois.
  useEffect(() => {
    if (props.sentCount === 0) return;
    setText("");
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
    return members
      .filter((member) => member.userId !== myUserId && member.displayName.toLowerCase().includes(query))
      .slice(0, 6);
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
    const body = text.trim();
    if (!body || sending) return;
    // Mentions : les membres dont « @Nom » figure encore dans le texte.
    const mentions = members.filter((member) => body.includes(`@${member.displayName}`)).map((m) => m.userId);
    setSending(true);
    post({ type: "send", body, replyToId: replyTo?.id, mentions });
  };

  // Échec de l'envoi : on permet de réessayer.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "sendResult" && !event.data.ok) setSending(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
              <span className="codicon codicon-account" aria-hidden="true" />
              {member.displayName}
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
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
        <button
          type="button"
          className="send-button"
          onClick={send}
          disabled={!text.trim() || sending}
          title={strings.send}
          aria-label={strings.send}
        >
          <span className="codicon codicon-send" aria-hidden="true" />
        </button>
      </div>
      <p className="composer-hint">{strings.composerHint}</p>
    </div>
  );
}
