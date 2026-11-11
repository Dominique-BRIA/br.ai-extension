import type { MemoryItem, MemoryType, MessageAuthor } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { MemoryStore } from "./memoryStore";
import type { WorkspaceStore } from "./workspaceStore";

export type MemoryNode =
  | { kind: "group"; group: MemoryType | "history" }
  | { kind: "item"; item: MemoryItem };

const ICONS: Record<MemoryType | "history", string> = {
  decision: "law",
  question: "question",
  task: "tasklist",
  compromise: "git-merge",
  knowledge: "globe",
  history: "history",
};

const GROUPS: (MemoryType | "history")[] = [
  "decision",
  "question",
  "task",
  "compromise",
  "knowledge",
  "history",
];

export function groupLabel(group: MemoryType | "history"): string {
  switch (group) {
    case "decision":
      return vscode.l10n.t("Decisions");
    case "question":
      return vscode.l10n.t("Open questions");
    case "task":
      return vscode.l10n.t("Tasks");
    case "compromise":
      return vscode.l10n.t("Compromises under discussion");
    case "knowledge":
      return vscode.l10n.t("Knowledge");
    case "history":
      return vscode.l10n.t("History");
  }
}

export function authorLabel(author: MessageAuthor): string {
  switch (author.kind) {
    case "member":
      return author.displayName;
    case "former_member":
      return vscode.l10n.t("Former member");
    case "serveur":
      return vscode.l10n.t("The server");
    case "cuisinier":
      return vscode.l10n.t("The cook");
  }
}

/** Éléments ouverts dans leur groupe ; les éléments résolus ou stoppés vont dans l'historique. */
export function itemsOf(items: MemoryItem[], group: MemoryType | "history"): MemoryItem[] {
  return group === "history"
    ? items.filter((item) => item.status !== "open").reverse()
    : items.filter((item) => item.type === group && item.status === "open");
}

/** Vue native « Mémoire du projet ». */
export class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryNode>, vscode.Disposable {
  readonly #onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;
  readonly #subscriptions: vscode.Disposable[];

  constructor(
    private readonly memory: MemoryStore,
    private readonly workspace: WorkspaceStore,
  ) {
    this.#subscriptions = [
      memory.onDidChange(() => this.#onDidChangeTreeData.fire()),
      workspace.onDidChange(() => this.#onDidChangeTreeData.fire()),
    ];
  }

  getChildren(node?: MemoryNode): MemoryNode[] {
    const items = this.memory.items;
    if (!node) {
      return GROUPS.filter((group) => itemsOf(items, group).length > 0).map((group) => ({
        kind: "group",
        group,
      }));
    }
    if (node.kind === "group") return itemsOf(items, node.group).map((item) => ({ kind: "item", item }));
    return [];
  }

  getTreeItem(node: MemoryNode): vscode.TreeItem {
    if (node.kind === "group") {
      const count = itemsOf(this.memory.items, node.group).length;
      const item = new vscode.TreeItem(
        groupLabel(node.group),
        node.group === "history"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `memory-group:${node.group}`;
      item.iconPath = new vscode.ThemeIcon(ICONS[node.group]);
      item.description = String(count);
      return item;
    }

    const { item: memory } = node;
    const item = new vscode.TreeItem(memory.text, vscode.TreeItemCollapsibleState.None);
    item.id = `memory:${memory.id}`;
    const status =
      memory.status === "stopped"
        ? vscode.l10n.t("stopped")
        : memory.status === "resolved"
          ? vscode.l10n.t("resolved")
          : undefined;
    item.description = [status, authorLabel(memory.proposedBy)].filter(Boolean).join(" · ");
    item.iconPath = new vscode.ThemeIcon(memory.status === "open" ? ICONS[memory.type] : "pass");
    item.tooltip = new vscode.MarkdownString(
      `**${groupLabel(memory.type)}**\n\n${memory.text}\n\n_${authorLabel(memory.proposedBy)} · ${new Date(
        memory.createdAt,
      ).toLocaleString(vscode.env.language)}_`,
    );
    const isChef = this.#myRole() === "chef";
    item.contextValue = `memory.${memory.type}.${memory.status}${isChef ? ".chef" : ""}`;
    if (memory.sourceMessageId) {
      item.command = {
        command: "bria.memory.reveal",
        title: vscode.l10n.t("Show in chat"),
        arguments: [node],
      };
    }
    return item;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChangeTreeData.dispose();
  }

  #myRole() {
    const projectId = this.memory.projectId;
    return projectId ? this.workspace.project(projectId)?.team.myRole : undefined;
  }
}

/** La mémoire du projet en Markdown, pour la lire d'un bloc (aperçu Markdown de VS Code). */
export class MemoryDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = "bria-memory";
  readonly #onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #subscription: vscode.Disposable;

  constructor(
    private readonly memory: MemoryStore,
    private readonly workspace: WorkspaceStore,
  ) {
    this.#subscription = memory.onDidChange(() => {
      if (memory.projectId) this.#onDidChange.fire(MemoryDocumentProvider.uri(memory.projectId));
    });
  }

  static uri(projectId: string): vscode.Uri {
    return vscode.Uri.from({ scheme: MemoryDocumentProvider.scheme, path: `/${projectId}/memoire.md` });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const projectId = uri.path.split("/")[1];
    const found = projectId ? this.workspace.project(projectId) : undefined;
    const items = projectId === this.memory.projectId ? this.memory.items : [];
    const lines = [`# ${vscode.l10n.t("Project memory")} · ${found?.project.name ?? ""}`, ""];
    for (const group of GROUPS) {
      const groupItems = itemsOf(items, group);
      if (groupItems.length === 0) continue;
      lines.push(`## ${groupLabel(group)}`, "");
      for (const item of groupItems) {
        const date = new Date(item.createdAt).toLocaleDateString(vscode.env.language);
        const status = item.status === "stopped" ? vscode.l10n.t("stopped") : vscode.l10n.t("resolved");
        const prefix = group === "history" ? `${groupLabel(item.type)} (${status}) : ` : "";
        lines.push(`- ${prefix}${item.text} — *${authorLabel(item.proposedBy)}, ${date}*`);
      }
      lines.push("");
    }
    if (items.length === 0) lines.push(vscode.l10n.t("Nothing yet."));
    return lines.join("\n");
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#onDidChange.dispose();
  }
}
