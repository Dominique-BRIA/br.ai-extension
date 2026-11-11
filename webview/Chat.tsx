import type { MemoryType, Message, MessageAuthor } from "@br-ia/protocol";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CatchUp, ChatStrings, ChatViewState, ToWebview } from "../src/webviewMessages";
import { Attachments } from "./Attachments";
import { Composer } from "./Composer";
import { FilesTab } from "./FilesTab";
import { authorName, continuesPrevious, formatDay, formatTime, initials, sameDay } from "./format";
import { BottomNav, Header, type Screen, type Tab } from "./Header";
import { Markdown } from "./Markdown";
import { MemoryTab } from "./MemoryTab";
import { activeOrder, OrderDetails, OrderPill, OrdersTab } from "./Orders";
import { TeamTab } from "./TeamTab";
import { post } from "./vscodeApi";

type ProjectState = Extract<ChatViewState, { view: "project" }>;

const NOTE_ICONS: Record<MemoryType, string> = {
  decision: "law",
  question: "question",
  task: "tasklist",
  compromise: "git-merge",
  knowledge: "globe",
};

interface Props {
  state: ProjectState;
  strings: ChatStrings;
  locale: string;
  logoUri: string;
  connected: boolean;
  unread: number;
  onScreen(screen: Screen): void;
}

/** Résumé « pendant votre absence », en haut du fil, jusqu'à ce que le membre le ferme. */
function CatchUpCard({ catchUp, strings }: { catchUp: CatchUp; strings: ChatStrings }) {
  return (
    <article className="catch-up" aria-live="polite">
      <div className="catch-up-head">
        <span className="codicon codicon-history" aria-hidden="true" />
        <span className="catch-up-title">{strings.catchUpTitle}</span>
        {catchUp.count > 0 && (
          <span className="meta">{strings.catchUpCount.replace("{0}", String(catchUp.count))}</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="icon-button"
          title={strings.close}
          aria-label={strings.close}
          onClick={() => post({ type: "dismissCatchUp" })}
        >
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      </div>
      {catchUp.summary ? (
        <Markdown text={catchUp.summary} diagramError={strings.diagramError} />
      ) : (
        <p className="meta">
          <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />{" "}
          {strings.catchUpLoading}
        </p>
      )}
    </article>
  );
}

/** Initiales d'un membre, ou « IA » pour les agents. */
function authorInitials(author: MessageAuthor, strings: ChatStrings): string {
  if (author.kind === "serveur" || author.kind === "cuisinier") return "IA";
  return initials(authorName(author, strings));
}

/** Le panneau d'un projet : en-tête, l'onglet choisi, puis la navigation du bas. */
export function Chat({ state, strings, locale, logoUri, connected, unread, onScreen }: Props) {
  const [tab, setTab] = useState<Tab>("chat");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Le contenu du fil, dont la hauteur change quand un message s'affiche ou finit de se dessiner. */
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef({
    first: "",
    last: "",
    height: 0,
    nearBottom: true,
    element: null as HTMLDivElement | null,
    projectId: "",
  });
  const current = activeOrder(state.orders);
  const sections: Record<Tab, string> = {
    chat: strings.tabChat,
    memory: strings.tabMemory,
    orders: strings.tabOrders,
    files: strings.tabFiles,
    team: strings.tabTeam,
  };

  // Défilement : en bas à l'ouverture du fil (nouveau projet, retour sur l'onglet Chat) et à
  // l'arrivée d'un message si on y était déjà ; position conservée quand des messages plus
  // anciens s'ajoutent en haut.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on refait le calcul en revenant sur l'onglet Chat.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const first = state.messages[0]?.id ?? "";
    const last = state.outgoing.at(-1)?.clientId ?? state.messages.at(-1)?.id ?? "";
    const before = previous.current;
    const opened = element !== before.element || state.projectId !== before.projectId;
    let nearBottom = before.nearBottom;
    if (opened) {
      element.scrollTop = element.scrollHeight;
      nearBottom = true;
    } else if (first !== before.first && last === before.last && before.height > 0) {
      element.scrollTop += element.scrollHeight - before.height;
    } else if (last !== before.last && (before.nearBottom || !before.last)) {
      element.scrollTop = element.scrollHeight;
    }
    previous.current = {
      first,
      last,
      height: element.scrollHeight,
      nearBottom,
      element,
      projectId: state.projectId,
    };
  }, [state.messages, state.outgoing, state.projectId, tab]);

  // Le fil grandit encore après l'affichage (code coloré, diagrammes, carte d'absence) :
  // tant qu'on est en bas, on y reste.
  // biome-ignore lint/correctness/useExhaustiveDependencies: l'observateur suit le contenu de l'onglet Chat.
  useEffect(() => {
    const element = list.current;
    const inner = content.current;
    if (!element || !inner) return;
    const observer = new ResizeObserver(() => {
      if (pendingReveal.current) return;
      if (previous.current.nearBottom) element.scrollTop = element.scrollHeight;
      previous.current.height = element.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [tab]);

  /** Message à atteindre quand des messages plus anciens auront été chargés. */
  const pendingReveal = useRef<string | null>(null);

  /** Remonte au message cité, en chargeant les plus anciens s'il n'est pas encore affiché. */
  const goToMessage = (messageId: string) => {
    if (state.messages.some((message) => message.id === messageId)) {
      showMessage(messageId);
    } else if (state.hasMore) {
      pendingReveal.current = messageId;
      post({ type: "loadOlder" });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: on réessaie à chaque page de messages chargée.
  useEffect(() => {
    const target = pendingReveal.current;
    if (!target || state.loadingOlder) return;
    if (state.messages.some((message) => message.id === target)) {
      pendingReveal.current = null;
      showMessage(target);
    } else if (state.hasMore) {
      post({ type: "loadOlder" });
    } else {
      pendingReveal.current = null;
    }
  }, [state.messages, state.loadingOlder]);

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
        section={sections[tab]}
        teamName={`${state.teamName} · ${state.projectName}`}
        onlineCount={state.onlineCount}
        memberCount={state.members.length}
        connected={connected}
        unread={unread}
        onScreen={onScreen}
        strings={strings}
      />

      {tab === "memory" && (
        <MemoryTab
          items={state.memory}
          orders={state.orders}
          projectName={state.projectName}
          isChef={state.isChef}
          myUserId={state.myUserId}
          strings={strings}
          locale={locale}
          onShowMessage={showMessage}
        />
      )}

      {tab === "files" && (
        <FilesTab
          projectId={state.projectId}
          messageCount={state.messages.length}
          strings={strings}
          locale={locale}
        />
      )}

      {tab === "orders" && (
        <OrdersTab
          cloudAvailable={state.cloudAvailable}
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
            <div ref={content}>
              {state.catchUp && <CatchUpCard catchUp={state.catchUp} strings={strings} />}
              {current && <OrderPill order={current} strings={strings} onOpen={() => setTab("orders")} />}

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
                // Le message où le cuisinier prend la commande : ses étapes sont consultables dessous.
                const taken =
                  message.author.kind === "cuisinier"
                    ? /^Je (?:commence|reprends) la \*\*commande n° (\d+)\*\*/.exec(message.body)
                    : null;
                const takenOrder = taken
                  ? state.orders.find((order) => order.number === Number(taken[1]))
                  : undefined;
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
                              {authorInitials(message.author, strings)}
                            </span>
                          )}
                          <span className="author">
                            {authorName(message.author, strings, state.myUserId)}
                          </span>
                          {agent && <span className="agent-label">{"<br/>"}</span>}
                          {!mine && (
                            <time dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
                          )}
                        </div>
                      )}
                      <div className="bubble">
                        {message.replyTo && (
                          <button
                            type="button"
                            className="quoted"
                            title={strings.showInChat}
                            onClick={() => message.replyTo && goToMessage(message.replyTo.id)}
                          >
                            <span className="quoted-author">
                              <span className="codicon codicon-reply" aria-hidden="true" />
                              {authorName(message.replyTo.author, strings, state.myUserId)}
                            </span>
                            <span className="quoted-text">{message.replyTo.excerpt}</span>
                          </button>
                        )}
                        {message.body && <Markdown text={message.body} diagramError={strings.diagramError} />}
                        <Attachments attachments={message.attachments} strings={strings} locale={locale} />
                        {mine && (
                          <span className="message-status" title={strings.messageSent}>
                            <span className="codicon codicon-check" aria-hidden="true" />
                            <span className="sr-only">{strings.messageSent}</span>
                          </span>
                        )}
                      </div>
                      {takenOrder && <OrderDetails order={takenOrder} strings={strings} locale={locale} />}
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

              {state.outgoing.map((outgoing) => (
                <article
                  key={outgoing.clientId}
                  className={`message mine outgoing${outgoing.status === "failed" ? " failed" : ""}`}
                >
                  <div className="bubble">
                    {outgoing.replyTo && (
                      <span className="quoted">
                        <span className="quoted-author">
                          <span className="codicon codicon-reply" aria-hidden="true" />
                          {authorName(outgoing.replyTo.author, strings, state.myUserId)}
                        </span>
                        <span className="quoted-text">{outgoing.replyTo.excerpt}</span>
                      </span>
                    )}
                    {outgoing.body && <Markdown text={outgoing.body} diagramError={strings.diagramError} />}
                    <Attachments attachments={outgoing.attachments} strings={strings} locale={locale} />
                    {outgoing.status === "sending" ? (
                      <span className="message-status" title={strings.messageSending}>
                        <span className="codicon codicon-clock" aria-hidden="true" />
                        <span className="sr-only">{strings.messageSending}</span>
                      </span>
                    ) : (
                      <span className="message-status failed">
                        <span className="codicon codicon-error" aria-hidden="true" />
                        {strings.messageFailed}
                      </span>
                    )}
                  </div>
                  {outgoing.status === "failed" && (
                    <div className="outgoing-actions">
                      <button
                        type="button"
                        className="link"
                        onClick={() => post({ type: "retrySend", clientId: outgoing.clientId })}
                      >
                        <span className="codicon codicon-refresh" aria-hidden="true" />
                        {strings.retrySend}
                      </button>
                      <button
                        type="button"
                        className="link"
                        onClick={() => post({ type: "discardSend", clientId: outgoing.clientId })}
                      >
                        <span className="codicon codicon-trash" aria-hidden="true" />
                        {strings.discardSend}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <Composer
            projectId={state.projectId}
            members={state.members}
            myUserId={state.myUserId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            strings={strings}
            locale={locale}
            sending={state.outgoing.some((outgoing) => outgoing.status === "sending")}
            permissionMode={state.permissionMode}
          />
        </>
      )}

      {tab === "team" && (
        <TeamTab
          teamName={state.teamName}
          projectName={state.projectName}
          chefName={state.chefName}
          invitation={state.invitation}
          vault={state.vault}
          usage={state.usage}
          members={state.members}
          myUserId={state.myUserId}
          isChef={state.isChef}
          connected={connected}
          orders={state.orders}
          folderLinked={state.folderLinked}
          repo={state.repo}
          strings={strings}
          locale={locale}
        />
      )}

      <BottomNav
        tab={tab}
        onTab={setTab}
        openMemory={state.memory.filter((item) => item.status === "open").length}
        ordersSignal={current ? (current.status === "running" ? "running" : "pending") : null}
        strings={strings}
      />
    </div>
  );
}
