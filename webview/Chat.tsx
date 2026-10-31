import type { Message } from "@br-ia/protocol";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { ChatStrings, ChatViewState } from "../src/webviewMessages";
import { Composer } from "./Composer";
import { authorName, continuesPrevious, formatDay, formatTime, sameDay } from "./format";
import { Markdown } from "./Markdown";
import { post } from "./vscodeApi";

type ProjectState = Extract<ChatViewState, { view: "project" }>;

interface Props {
  state: ProjectState;
  strings: ChatStrings;
  locale: string;
  sentCount: number;
}

/** Le fil d'un projet : messages groupés par jour et par auteur, puis la zone de saisie. */
export function Chat({ state, strings, locale, sentCount }: Props) {
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef({ first: "", last: "", height: 0, nearBottom: true });

  // Défilement : en bas à l'ouverture et à l'arrivée d'un message si on y était déjà ;
  // position conservée quand des messages plus anciens s'ajoutent en haut.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const first = state.messages[0]?.id ?? "";
    const last = state.messages.at(-1)?.id ?? "";
    const before = previous.current;
    if (first !== before.first && last === before.last && before.height > 0) {
      element.scrollTop += element.scrollHeight - before.height;
    } else if (last !== before.last && (before.nearBottom || !before.last)) {
      element.scrollTop = element.scrollHeight;
    }
    previous.current = { first, last, height: element.scrollHeight, nearBottom: before.nearBottom };
  }, [state.messages]);

  const onScroll = () => {
    const element = list.current;
    if (!element) return;
    previous.current.nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    previous.current.height = element.scrollHeight;
  };

  return (
    <div className="chat">
      <header className="chat-header">
        <h1>{state.projectName}</h1>
        <span className="chat-team">{state.teamName}</span>
      </header>

      <div className="messages" ref={list} onScroll={onScroll}>
        {state.hasMore && (
          <button
            type="button"
            className="link load-older"
            disabled={state.loadingOlder}
            onClick={() => post({ type: "loadOlder" })}
          >
            {state.loadingOlder ? strings.loading : strings.loadOlder}
          </button>
        )}

        {state.messages.length === 0 && (
          <section className="empty">
            <h2>{strings.emptyChatTitle}</h2>
            <p>{strings.emptyChatBody}</p>
          </section>
        )}

        {state.messages.map((message, index) => {
          const before = state.messages[index - 1];
          const newDay = !before || !sameDay(before.createdAt, message.createdAt);
          const grouped = !newDay && continuesPrevious(before, message);
          const mentionsMe = message.mentions.includes(state.myUserId);
          return (
            <Fragment key={message.id}>
              {newDay && (
                <h2 className="day">
                  <span>{formatDay(message.createdAt, locale, strings)}</span>
                </h2>
              )}
              <article
                className={["message", grouped && "grouped", mentionsMe && "mentions-me", message.author.kind]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={mentionsMe ? strings.mentionsYou : undefined}
              >
                {!grouped && (
                  <div className="message-head">
                    <span className="author">{authorName(message.author, strings, state.myUserId)}</span>
                    {(message.author.kind === "serveur" || message.author.kind === "cuisinier") && (
                      <span className="agent-label">br.ia</span>
                    )}
                    <time dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
                  </div>
                )}
                {message.replyTo && (
                  <div className="quoted">
                    <span className="codicon codicon-reply" aria-hidden="true" />
                    <span className="quoted-author">
                      {authorName(message.replyTo.author, strings, state.myUserId)}
                    </span>
                    <span className="quoted-text">{message.replyTo.excerpt}</span>
                  </div>
                )}
                <Markdown text={message.body} />
                <div className="message-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={strings.reply}
                    aria-label={strings.reply}
                    onClick={() => setReplyTo(message)}
                  >
                    <span className="codicon codicon-reply" aria-hidden="true" />
                  </button>
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>

      <Composer
        projectId={state.projectId}
        members={state.members}
        myUserId={state.myUserId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        strings={strings}
        sentCount={sentCount}
      />
    </div>
  );
}
