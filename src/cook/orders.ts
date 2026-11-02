import type { Order, OrderStatus, OrdersResponse } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "../api";
import type { Connection } from "../connection";
import type { WorkspaceStore } from "../workspaceStore";
import type { Checkpoints } from "./checkpoints";
import type { ProjectFolders } from "./projectFolders";

/** Les commandes du projet ouvert, tenues à jour par les événements du serveur. */
export class OrdersStore implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #onDidFinish = new vscode.EventEmitter<Order>();
  /** Une commande vient de se terminer (terminée, non aboutie ou arrêtée). */
  readonly onDidFinish = this.#onDidFinish.event;
  readonly #onDidMerge = new vscode.EventEmitter<Order>();
  /** La branche d'une commande vient d'être fusionnée par un autre membre. */
  readonly onDidMerge = this.#onDidMerge.event;
  /** Commandes validées depuis cette machine : le membre sait déjà qu'elles sont fusionnées. */
  readonly #mergedHere = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  #projectId: string | undefined;
  #orders: Order[] = [];
  /** Numéros connus de toutes les commandes reçues, pour les titres. */
  readonly #known = new Map<string, Order>();

  constructor(
    private readonly api: Api,
    connection: Connection,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.#subscriptions = [
      connection.onEvent((event) => {
        if (event.type !== "order.updated") return;
        const previous = this.#known.get(event.order.id);
        this.#known.set(event.order.id, event.order);
        if (previous?.status === "running" && event.order.status !== "running")
          this.#onDidFinish.fire(event.order);
        if (event.order.merged && !previous?.merged && !this.#mergedHere.has(event.order.id))
          this.#onDidMerge.fire(event.order);
        if (event.order.projectId !== this.#projectId) return;
        const index = this.#orders.findIndex((order) => order.id === event.order.id);
        if (index >= 0) this.#orders[index] = event.order;
        else this.#orders.unshift(event.order);
        this.#publish();
      }),
      connection.onDidChangeState((state) => {
        if (state.status === "connected") void this.refresh();
      }),
    ];
  }

  get orders(): Order[] {
    return this.#orders;
  }

  /** À appeler avant d'annoncer au serveur une fusion faite depuis cette machine. */
  markMergedHere(orderId: string): void {
    this.#mergedHere.add(orderId);
  }

  /** « Commande n° 3 » si elle est connue. */
  describe(orderId: string): string {
    const order = this.#known.get(orderId);
    return order ? vscode.l10n.t("Order {0}", order.number) : vscode.l10n.t("Order");
  }

  async setProject(projectId: string | undefined): Promise<void> {
    this.#projectId = projectId;
    this.#orders = [];
    this.#publish();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId) return;
    try {
      const { orders } = await this.api.get<OrdersResponse>(`/projects/${projectId}/orders`);
      if (projectId !== this.#projectId) return;
      this.#orders = orders;
      for (const order of orders) this.#known.set(order.id, order);
      this.#publish();
    } catch (error) {
      this.log.warn(`Chargement des commandes impossible : ${(error as Error).message}`);
    }
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChange.dispose();
    this.#onDidFinish.dispose();
    this.#onDidMerge.dispose();
  }

  #publish(): void {
    void vscode.commands.executeCommand("setContext", "bria.ordersEmpty", this.#orders.length === 0);
    this.#onDidChange.fire();
  }
}

export type OrderNode = { kind: "order"; order: Order } | { kind: "step"; order: Order; index: number };

const ICONS: Record<OrderStatus, string> = {
  pending: "clock",
  running: "sync~spin",
  done: "pass",
  failed: "error",
  stopped: "debug-stop",
};

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return vscode.l10n.t("waiting");
    case "running":
      return vscode.l10n.t("in progress");
    case "done":
      return vscode.l10n.t("done");
    case "failed":
      return vscode.l10n.t("not completed");
    case "stopped":
      return vscode.l10n.t("stopped");
  }
}

/** Vue native « Commandes » : chaque commande, son statut et ses dernières étapes. */
export class OrdersTreeProvider implements vscode.TreeDataProvider<OrderNode>, vscode.Disposable {
  readonly #onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;
  readonly #subscriptions: vscode.Disposable[];
  /** Commandes qui ont des points de restauration sur cette machine. */
  #revertable = new Set<string>();

  constructor(
    private readonly store: OrdersStore,
    private readonly workspace: WorkspaceStore,
    private readonly checkpoints: Checkpoints,
    private readonly currentProject: () => string | undefined,
    private readonly folders: ProjectFolders,
  ) {
    this.#subscriptions = [
      store.onDidChange(() => void this.refresh()),
      folders.onDidChange(() => this.#onDidChangeTreeData.fire()),
    ];
  }

  async refresh(): Promise<void> {
    const revertable = new Set<string>();
    for (const order of this.store.orders) if (await this.checkpoints.has(order.id)) revertable.add(order.id);
    this.#revertable = revertable;
    this.#onDidChangeTreeData.fire();
  }

  getChildren(node?: OrderNode): OrderNode[] {
    if (!node) return this.store.orders.map((order) => ({ kind: "order", order }));
    if (node.kind === "order") {
      const count = node.order.steps.length;
      return node.order.steps
        .map((_step, index): OrderNode => ({ kind: "step", order: node.order, index }))
        .slice(Math.max(0, count - 15))
        .reverse();
    }
    return [];
  }

  getTreeItem(node: OrderNode): vscode.TreeItem {
    if (node.kind === "step") {
      const step = node.order.steps[node.index];
      const item = new vscode.TreeItem(step?.text ?? "", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(
        step?.kind === "write"
          ? "edit"
          : step?.kind === "command"
            ? "terminal"
            : step?.kind === "read"
              ? "eye"
              : step?.kind === "error"
                ? "warning"
                : "info",
      );
      item.description = step ? new Date(step.at).toLocaleTimeString(vscode.env.language) : undefined;
      return item;
    }

    const { order } = node;
    const item = new vscode.TreeItem(
      `${vscode.l10n.t("Order {0}", order.number)} · ${order.title}`,
      order.status === "running"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `order:${order.id}:${order.status}`;
    item.iconPath = new vscode.ThemeIcon(ICONS[order.status]);
    const noFolder = order.status === "pending" && !this.folders.get(order.projectId);
    item.description = [
      noFolder ? vscode.l10n.t("waiting for a folder on this machine") : statusLabel(order.status),
      order.machine?.displayName,
    ]
      .filter(Boolean)
      .join(" · ");
    item.tooltip = new vscode.MarkdownString(
      [
        `**${vscode.l10n.t("Order {0}", order.number)} · ${order.title}**`,
        "",
        order.brief,
        ...(order.summary ? ["", "---", "", order.summary] : []),
      ].join("\n"),
    );

    const me = this.workspace.current?.user.id;
    const projectId = this.currentProject();
    const isChef = projectId ? this.workspace.project(projectId)?.team.myRole === "chef" : false;
    const canStop =
      (order.status === "pending" || order.status === "running") &&
      (isChef || (order.requestedBy.kind === "member" && order.requestedBy.userId === me));
    item.contextValue = [
      "order",
      canStop && "stoppable",
      this.#revertable.has(order.id) && order.status !== "running" && "revertable",
    ]
      .filter(Boolean)
      .join(".");
    return item;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChangeTreeData.dispose();
  }
}
