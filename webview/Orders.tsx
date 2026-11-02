import type { Order, OrderStatus } from "@br-ia/protocol";
import { useState } from "react";
import type { ChatStrings } from "../src/webviewMessages";
import { formatRelative, formatTime, orderFiles } from "./format";
import { Markdown } from "./Markdown";
import { post } from "./vscodeApi";

const STEP_ICONS = {
  info: "info",
  read: "eye",
  write: "edit",
  command: "terminal",
  error: "warning",
} as const;
const FINISHED: OrderStatus[] = ["done", "failed", "stopped"];

/** La commande à suivre : la plus récente qui est en cours, sinon qui attend. */
export function activeOrder(orders: Order[]): Order | undefined {
  return (
    orders.find((order) => order.status === "running") ?? orders.find((order) => order.status === "pending")
  );
}

/** « CMD-003 » */
export const orderCode = (order: Order) => `CMD-${String(order.number).padStart(3, "0")}`;

interface PillProps {
  order: Order;
  strings: ChatStrings;
  onOpen(): void;
}

/** Rappel compact de la commande en cours, en haut du chat. */
export function OrderPill({ order, strings, onOpen }: PillProps) {
  return (
    <button type="button" className={`order-pill ${order.status}`} onClick={onOpen}>
      <span className={`status-dot ${order.status}`} aria-hidden="true" />
      <span className="order-pill-label">{strings.order.replace("{0}", String(order.number))} :</span>
      <span className="order-pill-title">{order.title}</span>
      <span className="order-pill-state">· {strings.orderStatus[order.status]}</span>
    </button>
  );
}

interface TabProps {
  orders: Order[];
  revertable: string[];
  folderLinked: boolean;
  permissionMode: string;
  myUserId: string;
  isChef: boolean;
  strings: ChatStrings;
  locale: string;
}

/** Onglet Commandes : la commande en cours en grand, puis toutes les commandes filtrables. */
export function OrdersTab(props: TabProps) {
  const { strings, locale } = props;
  const [filter, setFilter] = useState<"all" | "running" | "done">("all");
  const [open, setOpen] = useState<string | null>(null);
  const current = activeOrder(props.orders);
  const active = props.orders.filter((order) => order.status === "running" || order.status === "pending");
  const finished = props.orders.filter((order) => FINISHED.includes(order.status));
  const pendingQueue = props.orders.filter((order) => order.status === "pending").reverse();
  const shown = filter === "running" ? active : filter === "done" ? finished : props.orders;

  const isMine = (order: Order) =>
    props.isChef || (order.requestedBy.kind === "member" && order.requestedBy.userId === props.myUserId);
  const canPush = (order: Order) =>
    order.status === "done" && order.commit && !order.pushed && order.machine?.userId === props.myUserId;
  const canValidate = (order: Order) =>
    order.status === "done" && order.commit && order.pushed && !order.merged && isMine(order);

  const canStop = (order: Order) =>
    (order.status === "pending" || order.status === "running") &&
    (props.isChef || (order.requestedBy.kind === "member" && order.requestedBy.userId === props.myUserId));

  return (
    <div className="tab-body">
      <div className="section-head">
        <h2 className="section-title">
          <span className="status-dot running" aria-hidden="true" />
          {strings.ordersInProgress}
        </h2>
        <span className="pill">{strings.activeCount.replace("{0}", String(active.length))}</span>
      </div>

      {!props.folderLinked && (
        <div className="warning-box">
          <span>{strings.noFolder}</span>
          <button
            type="button"
            className="link"
            onClick={() => post({ type: "command", command: "linkFolder" })}
          >
            {strings.linkFolder}
          </button>
        </div>
      )}

      {current && (
        <article className={`active-order ${current.status}`}>
          <div className="active-order-meta">
            {orderCode(current)} ·{" "}
            {strings.requestedBy.replace(
              "{0}",
              current.requestedBy.kind === "member" ? current.requestedBy.displayName : strings.formerMember,
            )}
          </div>
          <h3 className="active-order-title">{current.title}</h3>

          <div className="progress-box">
            <div className="progress-label">
              <span className="codicon codicon-list-ordered" aria-hidden="true" />
              <span>
                {strings.stepOf
                  .replace("{0}", String(current.steps.length))
                  .replace("{1}", current.steps.at(-1)?.text ?? "")}
              </span>
            </div>
            <div className={`progress-track ${current.status}`}>
              <div className="progress-bar" />
            </div>
          </div>

          <div className="cook-row">
            <span className="cook-avatar">
              <span className="codicon codicon-tools" aria-hidden="true" />
            </span>
            <div className="cook-text">
              <div className="cook-name">{strings.cook}</div>
              <div className="cook-machine">
                {current.machine
                  ? strings.onMachine.replace("{0}", current.machine.displayName)
                  : strings.waitingMachine}
              </div>
            </div>
            <span className={`pill status ${current.status}`}>
              <span className={`status-dot ${current.status}`} aria-hidden="true" />
              {current.status === "running" ? strings.cookStatus.busy : strings.cookStatus.waiting}
            </span>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => post({ type: "command", command: "showCookTerminal" })}
            >
              <span className="codicon codicon-eye" aria-hidden="true" />
              {strings.viewStream}
            </button>
            {current.status === "running" &&
              current.branch &&
              (canStop(current) || current.machine?.userId === props.myUserId) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => post({ type: "orderAction", orderId: current.id, action: "relay" })}
                >
                  <span className="codicon codicon-arrow-swap" aria-hidden="true" />
                  {strings.relayOrder}
                </button>
              )}
            {canStop(current) && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => post({ type: "orderAction", orderId: current.id, action: "stop" })}
              >
                <span className="codicon codicon-debug-stop" aria-hidden="true" />
                {strings.stopOrder}
              </button>
            )}
          </div>
        </article>
      )}

      <div className="filters" role="tablist">
        {(
          [
            ["all", strings.filterAll, props.orders.length],
            ["running", strings.filterRunning, active.length],
            ["done", strings.filterDone, finished.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "filter active" : "filter"}
            onClick={() => setFilter(id)}
          >
            {label.replace("{0}", String(count))}
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="empty-text">{strings.noOrders}</p>}

      {shown.map((order) => {
        const expanded = open === order.id;
        const files = orderFiles(order);
        const queue = pendingQueue.findIndex((candidate) => candidate.id === order.id) + 1;
        return (
          <article key={order.id} className={`order-item ${order.status}`}>
            <div className="order-item-top">
              <span className="code">{orderCode(order)}</span>
              <span className={`pill status ${order.status}`}>{strings.orderStatus[order.status]}</span>
            </div>
            <h3 className="order-item-title">{order.title}</h3>
            {order.branch && (
              <div className="order-item-line order-item-git">
                <span className="codicon codicon-git-branch" aria-hidden="true" />
                <span className="order-item-branch">{order.branch}</span>
                {order.commit && (
                  <span>
                    {" · "}
                    {order.commit} ·{" "}
                    {order.merged
                      ? strings.orderMerged
                      : order.pushed
                        ? strings.orderPushed
                        : strings.orderNotPushed}
                  </span>
                )}
                {order.pullRequest && (
                  <span>
                    {" · "}
                    <a href={order.pullRequest.url}>
                      {strings.pullRequestLabel.replace("{0}", String(order.pullRequest.number))}
                    </a>
                  </span>
                )}
              </div>
            )}
            <div className="order-item-line">
              {FINISHED.includes(order.status) ? (
                <>
                  <span
                    className={`codicon codicon-${order.status === "done" ? "pass" : "circle-slash"}`}
                    aria-hidden="true"
                  />
                  {strings.finishedAgo.replace("{0}", formatRelative(order.updatedAt, locale))}
                </>
              ) : order.status === "pending" ? (
                <>
                  <span className="codicon codicon-clock" aria-hidden="true" />
                  {strings.startsWhenMachine}
                  {queue > 0 && (
                    <span className="queue">{strings.queuePosition.replace("{0}", String(queue))}</span>
                  )}
                </>
              ) : (
                <>
                  <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                  {order.machine ? strings.onMachine.replace("{0}", order.machine.displayName) : ""}
                </>
              )}
            </div>

            <div className="order-item-actions">
              {files.map((file) => (
                <button
                  key={file}
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "openProjectFile", path: file })}
                >
                  <span className="codicon codicon-go-to-file" aria-hidden="true" />
                  {strings.openFile} {file}
                </button>
              ))}
              {canPush(order) && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "orderAction", orderId: order.id, action: "push" })}
                >
                  <span className="codicon codicon-cloud-upload" aria-hidden="true" />
                  {strings.pushOrder}
                </button>
              )}
              {canValidate(order) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => post({ type: "orderAction", orderId: order.id, action: "validate" })}
                >
                  <span className="codicon codicon-git-merge" aria-hidden="true" />
                  {strings.validateOrder}
                </button>
              )}
              {/* Une fois commité, le travail est dans l'historique : le restaurer bloquerait la commande suivante. */}
              {props.revertable.includes(order.id) && order.status !== "running" && !order.commit && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "orderAction", orderId: order.id, action: "revert" })}
                >
                  <span className="codicon codicon-discard" aria-hidden="true" />
                  {strings.revertOrder}
                </button>
              )}
              {canStop(order) && order.id !== current?.id && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => post({ type: "orderAction", orderId: order.id, action: "stop" })}
                >
                  <span className="codicon codicon-debug-stop" aria-hidden="true" />
                  {strings.stopOrder}
                </button>
              )}
              <button
                type="button"
                className="ghost-button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : order.id)}
              >
                <span className={`codicon codicon-chevron-${expanded ? "up" : "down"}`} aria-hidden="true" />
                {strings.details}
              </button>
            </div>

            {expanded && (
              <div className="order-details">
                <p className="order-brief">{order.brief}</p>
                {order.summary && <Markdown text={order.summary} diagramError={strings.diagramError} />}
                {order.handoffNote && (
                  <>
                    <h4 className="subtitle">{strings.handoffTitle}</h4>
                    <Markdown text={order.handoffNote} diagramError={strings.diagramError} />
                  </>
                )}
                <ol className="steps">
                  {[...order.steps].reverse().map((step) => (
                    <li key={`${step.at}-${step.text}`} className={step.kind}>
                      <span className={`codicon codicon-${STEP_ICONS[step.kind]}`} aria-hidden="true" />
                      <span className="step-text">{step.text}</span>
                      <time dateTime={step.at}>{formatTime(step.at, locale)}</time>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
        );
      })}

      <div className="mode-line">
        <span>
          {strings.mode.replace("{0}", strings.modes[props.permissionMode as keyof ChatStrings["modes"]])}
        </span>
        <button
          type="button"
          className="link"
          onClick={() => post({ type: "command", command: "setPermissionMode" })}
        >
          {strings.changeMode}
        </button>
      </div>
    </div>
  );
}
