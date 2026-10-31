import type { CreateInvitationResponse, Project, Team } from "@br-ia/protocol";
import * as vscode from "vscode";
import { type Api, ApiRequestError } from "./api";
import type { ChatViewProvider } from "./chatView";
import type { Connection } from "./connection";
import { type Session, signInFlow } from "./session";
import type { TeamsNode } from "./teamsView";
import type { WorkspaceStore } from "./workspaceStore";

interface Deps {
  api: Api;
  session: Session;
  connection: Connection;
  store: WorkspaceStore;
  chat: ChatViewProvider;
  log: vscode.LogOutputChannel;
  machineId: string;
}

/** Enregistre les commandes de l'extension. Les erreurs du serveur sont affichées à la personne. */
export function registerCommands(deps: Deps): vscode.Disposable[] {
  const { api, session, connection, store, chat, log } = deps;

  const command = (id: string, run: (...args: never[]) => Promise<unknown> | unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await run(...args);
      } catch (error) {
        const message =
          error instanceof ApiRequestError && error.code === "network"
            ? vscode.l10n.t("The br.ia server cannot be reached.")
            : (error as Error).message;
        log.error(`${id} : ${(error as Error).message}`);
        void vscode.window.showErrorMessage(message);
      }
    });

  /** Équipe visée : celle du nœud cliqué, sinon choix dans une liste. */
  const pickTeam = async (node?: TeamsNode, onlyChef = false): Promise<Team | undefined> => {
    if (node && "team" in node) return node.team;
    const teams = (store.current?.teams ?? []).filter((team) => !onlyChef || team.myRole === "chef");
    if (teams.length <= 1) return teams[0];
    const picked = await vscode.window.showQuickPick(
      teams.map((team) => ({ label: team.name, team })),
      { placeHolder: vscode.l10n.t("Choose a team") },
    );
    return picked?.team;
  };

  const askName = (title: string, value?: string) =>
    vscode.window.showInputBox({
      title,
      value,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim() ? undefined : vscode.l10n.t("Enter a name.")),
    });

  return [
    command("bria.signIn", async () => {
      await signInFlow(api, session, deps.machineId);
    }),

    command("bria.signOut", async () => {
      await api.post("/auth/logout").catch(() => undefined);
      await session.clear();
    }),

    command("bria.connect", () => connection.connect()),
    command("bria.disconnect", () => connection.disconnect()),
    command("bria.showLog", () => log.show()),
    command("bria.refresh", () => store.refresh()),

    command("bria.createTeam", async () => {
      const name = await askName(vscode.l10n.t("New team name"));
      if (!name) return;
      await api.post<{ team: Team }>("/teams", { name });
      await store.refresh();
    }),

    command("bria.joinTeam", async () => {
      const code = await vscode.window.showInputBox({
        title: vscode.l10n.t("Join a team"),
        prompt: vscode.l10n.t("Enter the invitation code given by the team lead."),
        placeHolder: "EQP-XXXX-XXXX",
        ignoreFocusOut: true,
      });
      if (!code) return;
      const { team } = await api.post<{ team: Team }>("/invitations/accept", { code });
      await store.refresh();
      void vscode.window.showInformationMessage(vscode.l10n.t("You joined {0}.", team.name));
    }),

    command("bria.invite", async (node?: TeamsNode) => {
      const team = await pickTeam(node, true);
      if (!team) return;
      const invitation = await api.post<CreateInvitationResponse>(`/teams/${team.id}/invitations`);
      const copy = vscode.l10n.t("Copy code");
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          "Invitation code for {0}: {1}. Valid 7 days. Share it with your teammates.",
          team.name,
          invitation.code,
        ),
        copy,
      );
      if (choice === copy) await vscode.env.clipboard.writeText(invitation.code);
    }),

    command("bria.leaveTeam", async (node?: TeamsNode) => {
      const team = await pickTeam(node);
      if (!team) return;
      const leave = vscode.l10n.t("Leave");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Leave {0}? You will no longer see its projects.", team.name),
        { modal: true },
        leave,
      );
      if (answer !== leave) return;
      await api.post(`/teams/${team.id}/leave`);
      await store.refresh();
    }),

    command("bria.createProject", async (node?: TeamsNode) => {
      const team = await pickTeam(node);
      if (!team) return;
      const name = await askName(vscode.l10n.t("New project name in {0}", team.name));
      if (!name) return;
      const { project } = await api.post<{ project: Project }>(`/teams/${team.id}/projects`, { name });
      await store.refresh();
      await chat.open(project.id, true);
    }),

    command("bria.openProject", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      await chat.open(node.project.id, true);
    }),

    command("bria.renameProject", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      const name = await askName(vscode.l10n.t("Rename project"), node.project.name);
      if (!name) return;
      await api.patch(`/projects/${node.project.id}`, { name });
      await store.refresh();
    }),

    command("bria.archiveProject", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      const archive = vscode.l10n.t("Archive");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Archive {0}? It will disappear for the whole team.", node.project.name),
        { modal: true },
        archive,
      );
      if (answer !== archive) return;
      await api.patch(`/projects/${node.project.id}`, { archived: true });
      await store.refresh();
    }),

    command("bria.removeMember", async (node?: TeamsNode) => {
      if (node?.kind !== "member") return;
      const remove = vscode.l10n.t("Remove");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Remove {0} from {1}?", node.member.displayName, node.team.name),
        { modal: true, detail: vscode.l10n.t("Remember to change the secrets this member had access to.") },
        remove,
      );
      if (answer !== remove) return;
      await api.delete(`/teams/${node.team.id}/members/${node.member.userId}`);
      await store.refresh();
    }),

    command("bria.transferChef", async (node?: TeamsNode) => {
      if (node?.kind !== "member") return;
      const transfer = vscode.l10n.t("Transfer");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Make {0} the lead of {1}? You will become a regular member.",
          node.member.displayName,
          node.team.name,
        ),
        { modal: true },
        transfer,
      );
      if (answer !== transfer) return;
      await api.post(`/teams/${node.team.id}/transfer`, { userId: node.member.userId });
      await store.refresh();
    }),
  ];
}
