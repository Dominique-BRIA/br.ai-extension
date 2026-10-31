import type { MemoryType, Message, MessageAuthor } from "@br-ia/protocol";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatStrings, ChatViewState, ToWebview } from "../src/webviewMessages";
import { Attachments } from "./Attachments";
import { Composer } from "./Composer";
import { authorName, continuesPrevious, formatDay, formatTime, sameDay } from "./format";
import { Header, type Tab } from "./Header";
import { Markdown } from "./Markdown";
import { MemoryTab } from "./MemoryTab";
import { activeOrder, OrderCard, OrdersTab } from "./Orders";
import { post } from "./vscodeApi";

type ProjectState = Extract<ChatViewState, { view: "project" }>;

const NOTE_ICONS: Record<MemoryType, string> = {
  decision: "law",
  question: "question",
  task: "tasklist",
  compromise: "git-merge",
};

interface Props {
  state: ProjectState;
  strings: ChatStrings;
  locale: string;
  logoUri: string;
  connected: boolean;
  sentCount: number;
}

/** Initiales d'un membre, ou « IA » pour les agents. */
function initials(author: MessageAuthor, strings: ChatStrings): string {
  if (author.kind === "serveur" || author.kind === "cuisinier") return "IA";
  const letters = authorName(author, strings)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
  return letters.slice(0, 2).toUpperCase() || "?";
}

/** Le panneau d'un projet : en-tête, puis les onglets Chat, Mémoire et Commandes. */
export function Chat({ state, strings, locale, logoUri, connected, sentCount }: Props) {
  const [tab, setTab] = useState<Tab>("chat");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef({ first: "", last: "", height: 0, nearBottom: true });
  const current = activeOrder(state.orders);

  // Défilement : en bas à l'ouverture et à l'arrivée d'un message si on y était déjà ;
  // position conservée quand des messages plus anciens s'ajoutent en haut.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on refait le calcul en revenant sur l'onglet Chat.
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
  }, [state.messages, tab]);

  const showMessage = (messageId: string) => {
    setTab("chat");
    requestAnimationFrame(() => {
      const element = document.getElementById(`message-${messageId}`);
      if (!element) return;
      element.scrollIntoView({ block: "center" });
      element.classList.add("highlight");
      setTimeout(() => element.classList.remove("highlight"), 2000);
    });
  };

  // Demande de l'extension (clic dans la vue Mémoire) : aller au message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: showMessage ne dépend que de setTab, stable.
  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "reveal") showMessage(event.data.messageId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const onScroll = () => {
    const element = list.current;
    if (!element) return;
    previous.current.nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    previous.current.height = element.scrollHeight;
  };

  return (
    <div className="panel-root">
      <Header
        logoUri={logoUri}
        teamName={`${state.teamName} · ${state.projectName}`}
        onlineCount={state.onlineCount}
        memberCount={state.members.length}
        connected={connected}
        tab={tab}
        onTab={setTab}
        openMemory={state.memory.filter((item) => item.status === "open").length}
        ordersSignal={current ? (current.status === "running" ? "running" : "pending") : null}
        strings={strings}
      />

      {tab === "memory" && (
        <MemoryTab
          items={state.memory}
          isChef={state.isChef}
          myUserId={state.myUserId}
          strings={strings}
          locale={locale}
          onShowMessage={showMessage}
        />
      )}

      {tab === "orders" && (
        <OrdersTab
          orders={state.orders}
          revertable={state.revertable}
          folderLinked={state.folderLinked}
          permissionMode={state.permissionMode}
          myUserId={state.myUserId}
          isChef={state.isChef}
          strings={strings}
          locale={locale}
        />
      )}

      {tab === "chat" && (
        <>
          <div className="messages" ref={list} onScroll={onScroll}>
            {current && (
              <OrderCard
                order={current}
                strings={strings}
                locale={locale}
                folderLinked={state.folderLinked}
                onOpen={() => setTab("orders")}
              />
            )}

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
              const mine = message.author.kind === "member" && message.author.userId === state.myUserId;
              const agent = message.author.kind === "serveur" || message.author.kind === "cuisinier";
              const mentionsMe = message.mentions.includes(state.myUserId);
              const classes = [
                "message",
                mine ? "mine" : "theirs",
                agent && "agent",
                grouped && "grouped",
                mentionsMe && "mentions-me",
              ];
              return (
                <Fragment key={message.id}>
                  {newDay && (
                    <h2 className="day">
                      <span>
                        {formatDay(message.createdAt, locale, strings)} · {state.teamName}
                      </span>
                    </h2>
                  )}
                  <article
                    id={`message-${message.id}`}
                    className={classes.filter(Boolean).join(" ")}
                    aria-label={mentionsMe ? strings.mentionsYou : undefined}
                  >
                    {!grouped && (
                      <div className="message-head">
                        {mine ? (
                          <time dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
                        ) : (
                          <span className={agent ? "initials agent" : "initials"}>
                            {initials(message.author, strings)}
                          </span>
                        )}
                        <span className="author">{authorName(message.author, strings, state.myUserId)}</span>
                        {agent && <span className="agent-label">br.ia</span>}
                        {!mine && (
                          <time dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
                        )}
                      </div>
                    )}
                    <div className="bubble">
                      {message.replyTo && (
                        <div className="quoted">
                          <div className="quoted-author">
                            <span className="codicon codicon-reply" aria-hidden="true" />
                            {authorName(message.replyTo.author, strings, state.myUserId)}
                          </div>
                          <div className="quoted-text">{message.replyTo.excerpt}</div>
                        </div>
                      )}
                      {message.body && <Markdown text={message.body} diagramError={strings.diagramError} />}
                      <Attachments attachments={message.attachments} strings={strings} locale={locale} />
                    </div>
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
                  {(state.notes[message.id] ?? []).map((type) => (
                    <div key={type} className="note-pill">
                      <span>
                        <span className={`codicon codicon-${NOTE_ICONS[type]}`} aria-hidden="true" />
                        {strings.noted[type]}
                      </span>
                    </div>
                  ))}
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
            locale={locale}
            sentCount={sentCount}
          />
        </>
      )}
    </div>
  );
}
