import type { Project, Team, Workspace } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "./api";
import type { Connection } from "./connection";

/**
 * L'espace de travail du membre (équipes, membres, projets), tenu à jour
 * par les événements du serveur.
 */
export class WorkspaceStore implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<Workspace | undefined>();
  readonly onDidChange = this.#onDidChange.event;
  readonly #subscriptions: vscode.Disposable[];
  #workspace: Workspace | undefined;

  constructor(
    private readonly api: Api,
    connection: Connection,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.#subscriptions = [
      connection.onEvent((event) => {
        if (event.type === "workspace.changed") void this.refresh();
        if (event.type === "presence.changed") this.#setOnline(event.userId, event.online);
      }),
      // Après une reconnexion, la présence a pu changer : on recharge tout.
      connection.onDidChangeState((state) => {
        if (state.status === "connected") void this.refresh();
      }),
    ];
  }

  get current(): Workspace | undefined {
    return this.#workspace;
  }

  team(teamId: string): Team | undefined {
    return this.#workspace?.teams.find((team) => team.id === teamId);
  }

  project(projectId: string): { team: Team; project: Project } | undefined {
    for (const team of this.#workspace?.teams ?? []) {
      const project = team.projects.find((candidate) => candidate.id === projectId);
      if (project) return { team, project };
    }
    return undefined;
  }

  async refresh(): Promise<void> {
    try {
      this.#set(await this.api.get<Workspace>("/workspace"));
    } catch (error) {
      this.log.warn(`Chargement de l'espace de travail impossible : ${(error as Error).message}`);
    }
  }

  clear(): void {
    this.#set(undefined);
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#onDidChange.dispose();
  }

  #setOnline(userId: string, online: boolean): void {
    if (!this.#workspace) return;
    for (const team of this.#workspace.teams) {
      for (const member of team.members) if (member.userId === userId) member.online = online;
    }
    this.#set(this.#workspace);
  }

  #set(workspace: Workspace | undefined): void {
    this.#workspace = workspace;
    void vscode.commands.executeCommand("setContext", "bria.hasTeams", Boolean(workspace?.teams.length));
    this.#onDidChange.fire(workspace);
  }
}
