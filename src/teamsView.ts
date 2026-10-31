import type { Member, Project, Team } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { WorkspaceStore } from "./workspaceStore";

/** Les nœuds de l'arbre « Équipes ». `contextValue` pilote les menus contextuels. */
export type TeamsNode =
  | { kind: "team"; team: Team }
  | { kind: "project"; team: Team; project: Project }
  | { kind: "members"; team: Team }
  | { kind: "member"; team: Team; member: Member };

/** Vue native des équipes, de leurs projets et de leurs membres. */
export class TeamsTreeProvider implements vscode.TreeDataProvider<TeamsNode>, vscode.Disposable {
  readonly #onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;
  readonly #subscription: vscode.Disposable;
  #openProjectId: string | undefined;

  constructor(private readonly store: WorkspaceStore) {
    this.#subscription = store.onDidChange(() => this.#onDidChangeTreeData.fire());
  }

  /** Signale le projet ouvert dans le chat. */
  setOpenProject(projectId: string | undefined): void {
    this.#openProjectId = projectId;
    this.#onDidChangeTreeData.fire();
  }

  getChildren(node?: TeamsNode): TeamsNode[] {
    const workspace = this.store.current;
    if (!workspace) return [];
    if (!node) return workspace.teams.map((team) => ({ kind: "team", team }));
    switch (node.kind) {
      case "team":
        return [
          ...node.team.projects.map((project): TeamsNode => ({ kind: "project", team: node.team, project })),
          { kind: "members", team: node.team },
        ];
      case "members":
        return node.team.members.map((member): TeamsNode => ({ kind: "member", team: node.team, member }));
      default:
        return [];
    }
  }

  getTreeItem(node: TeamsNode): vscode.TreeItem {
    switch (node.kind) {
      case "team": {
        const item = new vscode.TreeItem(node.team.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `team:${node.team.id}`;
        item.iconPath = new vscode.ThemeIcon("organization");
        item.description = node.team.myRole === "chef" ? vscode.l10n.t("team lead") : undefined;
        item.contextValue = `team.${node.team.myRole}`;
        return item;
      }
      case "project": {
        const item = new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.None);
        item.id = `project:${node.project.id}`;
        item.iconPath = new vscode.ThemeIcon("comment-discussion");
        item.description = node.project.id === this.#openProjectId ? vscode.l10n.t("open") : undefined;
        item.contextValue = `project.${node.team.myRole}`;
        item.command = { command: "bria.openProject", title: vscode.l10n.t("Open"), arguments: [node] };
        return item;
      }
      case "members": {
        const online = node.team.members.filter((member) => member.online).length;
        const item = new vscode.TreeItem(vscode.l10n.t("Members"), vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `members:${node.team.id}`;
        item.iconPath = new vscode.ThemeIcon("account");
        item.description = vscode.l10n.t("{0} online of {1}", online, node.team.members.length);
        item.contextValue = "members";
        return item;
      }
      case "member": {
        const { member, team } = node;
        const isMe = member.userId === this.store.current?.user.id;
        const label = isMe ? vscode.l10n.t("{0} (you)", member.displayName) : member.displayName;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `member:${team.id}:${member.userId}`;
        item.iconPath = new vscode.ThemeIcon(member.online ? "circle-filled" : "circle-outline");
        const parts = [member.online ? vscode.l10n.t("online") : vscode.l10n.t("offline")];
        if (member.role === "chef") parts.unshift(vscode.l10n.t("team lead"));
        item.description = parts.join(" · ");
        item.contextValue = team.myRole === "chef" && !isMe ? "member.manageable" : "member";
        return item;
      }
    }
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#onDidChangeTreeData.dispose();
  }
}
