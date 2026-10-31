import type { Order, OrderStatus } from "@br-ia/protocol";
import { useState } from "react";
import type { ChatStrings } from "../src/webviewMessages";
import { formatTime } from "./format";
import { Markdown } from "./Markdown";
import { post } from "./vscodeApi";

const STATUS_ICONS: Record<OrderStatus, string> = {
  pending: "clock",
  running: "loading codicon-modifier-spin",
  done: "pass",
  failed: "error",
  stopped: "debug-stop",
};

const STEP_ICONS = {
  info: "info",
  read: "eye",
  write: "edit",
  command: "terminal",
  error: "warning",
} as const;

/** La commande à suivre : la plus récente qui attend ou qui est en cours. */
export function activeOrder(orders: Order[]): Order | undefined {
  return (
    orders.find((order) => order.status === "running") ?? orders.find((order) => order.status === "pending")
  );
}

interface CardProps {
  order: Order;
  strings: ChatStrings;
  locale: string;
  folderLinked: boolean;
  onOpen?: () => void;
}

/** Carte d'une commande en cours ou en attente, épinglée en haut du chat. */
export function OrderCard({ order, strings, locale, folderLinked, onOpen }: CardProps) {
  const waitingForFolder = order.status === "pending" && !folderLinked;
  return (
    <section
      className={`order-card ${order.status}`}
      aria-label={strings.order.replace("{0}", String(order.number))}
    >
      <div className="order-card-head">
        <span className={`status-dot ${order.status}`} aria-hidden="true" />
        <span className="order-card-status">
          {strings.order.replace("{0}", String(order.number))} · {strings.orderStatus[order.status]}
        </span>
        <time className="chip time" dateTime={order.updatedAt}>
          {formatTime(order.updatedAt, locale)}
        </time>
      </div>
      <button type="button" className="order-card-body" onClick={onOpen}>
        <span className="order-card-title">
          <span className="codicon codicon-checklist" aria-hidden="true" />
          {order.title}
        </span>
        <span className="order-card-brief">{order.brief}</span>
      </button>
      <div className="order-card-foot">
        <span className="assigned">
          <span className="status-dot small running" aria-hidden="true" />
          {order.machine
            ? strings.assignedTo.replace("{0}", order.machine.displayName)
            : strings.assignedNobody}
        </span>
        <span className={`order-state ${order.status}`}>
          {strings.orderStatus[order.status]}
          <span className={`codicon codicon-${STATUS_ICONS[order.status]}`} aria-hidden="true" />
        </span>
      </div>
      {waitingForFolder && (
        <div className="order-card-warning">
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
    </section>
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

/** Onglet Commandes : toutes les commandes du projet, leurs étapes et leurs actions. */
export function OrdersTab(props: TabProps) {
  const { strings, locale } = props;
  const [open, setOpen] = useState<string | null>(
    activeOrder(props.orders)?.id ?? props.orders[0]?.id ?? null,
  );
  return (
    <div className="tab-body">
      <div className="toolbar">
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
        <span className="spacer" />
        <button
          type="button"
          className="chip-button"
          onClick={() => post({ type: "command", command: "showCookTerminal" })}
        >
          <span className="codicon codicon-terminal" aria-hidden="true" />
          {strings.showTerminal}
        </button>
      </div>
      {!props.folderLinked && (
        <div className="order-card-warning standalone">
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
      {props.orders.length === 0 && <p className="empty-text">{strings.noOrders}</p>}
      {props.orders.map((order) => {
        const expanded = open === order.id;
        const mine = order.requestedBy.kind === "member" && order.requestedBy.userId === props.myUserId;
        const canStop = (order.status === "pending" || order.status === "running") && (mine || props.isChef);
        const canRevert = props.revertable.includes(order.id) && order.status !== "running";
        return (
          <article key={order.id} className={`order-item ${order.status}`}>
            <button
              type="button"
              className="order-item-head"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : order.id)}
            >
              <span className={`codicon codicon-${STATUS_ICONS[order.status]}`} aria-hidden="true" />
              <span className="order-item-title">
                {strings.order.replace("{0}", String(order.number))} · {order.title}
              </span>
              <span className={`order-state ${order.status}`}>{strings.orderStatus[order.status]}</span>
              <span className={`codicon codicon-chevron-${expanded ? "up" : "down"}`} aria-hidden="true" />
            </button>
            {expanded && (
              <div className="order-item-body">
                <p className="order-brief">{order.brief}</p>
                {order.summary && <Markdown text={order.summary} diagramError={strings.diagramError} />}
                {order.changedFiles.length > 0 && (
                  <ul className="files">
                    {order.changedFiles.map((file) => (
                      <li key={file}>
                        <span className="codicon codicon-file" aria-hidden="true" />
                        {file}
                      </li>
                    ))}
                  </ul>
                )}
                <h3 className="subtitle">{strings.steps}</h3>
                <ol className="steps">
                  {[...order.steps].reverse().map((step) => (
                    <li key={`${step.at}-${step.text}`} className={step.kind}>
                      <span className={`codicon codicon-${STEP_ICONS[step.kind]}`} aria-hidden="true" />
                      <span className="step-text">{step.text}</span>
                      <time dateTime={step.at}>{formatTime(step.at, locale)}</time>
                    </li>
                  ))}
                </ol>
                {(canStop || canRevert) && (
                  <div className="actions-row">
                    {canStop && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => post({ type: "orderAction", orderId: order.id, action: "stop" })}
                      >
                        <span className="codicon codicon-debug-stop" aria-hidden="true" />
                        {strings.stopOrder}
                      </button>
                    )}
                    {canRevert && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => post({ type: "orderAction", orderId: order.id, action: "revert" })}
                      >
                        <span className="codicon codicon-discard" aria-hidden="true" />
                        {strings.revertOrder}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
