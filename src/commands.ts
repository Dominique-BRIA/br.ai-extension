import type {
  CreateInvitationResponse,
  Locale,
  Project,
  SessionsResponse,
  Team,
  User,
} from "@br-ia/protocol";
import * as vscode from "vscode";
import { type Api, ApiRequestError } from "./api";
import type { ChatViewProvider } from "./chatView";
import type { Connection } from "./connection";
import type { MemoryStore } from "./memoryStore";
import { MemoryDocumentProvider, type MemoryNode } from "./memoryView";
import { type Session, signInFlow } from "./session";
import type { TeamsNode } from "./teamsView";
import type { WorkspaceStore } from "./workspaceStore";

interface Deps {
  api: Api;
  session: Session;
  connection: Connection;
  store: WorkspaceStore;
  chat: ChatViewProvider;
  memory: MemoryStore;
  log: vscode.LogOutputChannel;
  machineId: string;
}

/** Enregistre les commandes de l'extension. Les erreurs du serveur sont affichées à la personne. */
export function registerCommands(deps: Deps): vscode.Disposable[] {
  const { api, session, connection, store, chat, memory, log } = deps;

  const setMemoryStatus = async (node: MemoryNode | undefined, status: "open" | "resolved" | "stopped") => {
    if (node?.kind !== "item") return;
    await api.patch(`/memory/${node.item.id}`, { status });
    await memory.refresh();
  };

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

    command("bria.editProfile", async () => {
      const user = session.user;
      const token = session.token;
      if (!user || !token) return;
      const displayName = await askName(vscode.l10n.t("Your name"), user.displayName);
      if (!displayName) return;
      const languages: { label: string; locale: Locale }[] = [
        { label: "Français", locale: "fr" },
        { label: "English", locale: "en" },
      ];
      const language = await vscode.window.showQuickPick(languages, {
        title: vscode.l10n.t("Language of the emails br.ia sends you"),
        placeHolder: languages.find((item) => item.locale === user.locale)?.label,
      });
      if (!language) return;
      const updated = await api.patch<{ user: User }>("/me", { displayName, locale: language.locale });
      await session.signedIn(token, updated.user);
      await store.refresh();
    }),

    command("bria.manageMachines", async () => {
      const { sessions } = await api.get<SessionsResponse>("/me/sessions");
      const dateFormat = new Intl.DateTimeFormat(vscode.env.language, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const picked = await vscode.window.showQuickPick(
        sessions.map((machine) => ({
          label: [machine.os, machine.editor].filter(Boolean).join(" · ") || vscode.l10n.t("Unknown machine"),
          description: machine.current
            ? vscode.l10n.t("this machine")
            : machine.online
              ? vscode.l10n.t("online")
              : vscode.l10n.t("last seen {0}", dateFormat.format(new Date(machine.lastSeenAt))),
          detail: vscode.l10n.t("Signed in on {0}", dateFormat.format(new Date(machine.createdAt))),
          machine,
        })),
        {
          title: vscode.l10n.t("Machines signed in to your account"),
          placeHolder: vscode.l10n.t("Choose a machine to sign out"),
        },
      );
      if (!picked) return;
      const signOut = vscode.l10n.t("Sign out");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Sign out {0}?", picked.label),
        { modal: true, detail: vscode.l10n.t("This machine will need to sign in again to use br.ia.") },
        signOut,
      );
      if (answer !== signOut) return;
      await api.delete(`/me/sessions/${picked.machine.id}`);
      if (picked.machine.current) await session.clear();
      else void vscode.window.showInformationMessage(vscode.l10n.t("The machine has been signed out."));
    }),

    command("bria.deleteAccount", async () => {
      const user = session.user;
      if (!user) return;
      const proceed = vscode.l10n.t("Continue");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Delete your br.ia account?"),
        {
          modal: true,
          detail: vscode.l10n.t(
            'This cannot be undone. Your messages stay in your teams, signed "Former member". If you lead a team with other members, first make one of them lead.',
          ),
        },
        proceed,
      );
      if (answer !== proceed) return;
      const typed = await vscode.window.showInputBox({
        title: vscode.l10n.t("Delete your br.ia account"),
        prompt: vscode.l10n.t("To confirm, type your email address: {0}", user.email),
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().toLowerCase() === user.email
            ? undefined
            : vscode.l10n.t("The address does not match."),
      });
      if (!typed) return;
      await api.delete("/me", { confirmEmail: typed.trim() });
      await session.clear();
      void vscode.window.showInformationMessage(vscode.l10n.t("Your account has been deleted."));
    }),

    command("bria.memory.resolve", (node?: MemoryNode) => setMemoryStatus(node, "resolved")),
    command("bria.memory.reopen", (node?: MemoryNode) => setMemoryStatus(node, "open")),
    command("bria.memory.stop", async (node?: MemoryNode) => {
      if (node?.kind !== "item") return;
      const stop = vscode.l10n.t("Stop");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Stop this decision? The server agent will announce it in the chat."),
        { modal: true, detail: node.item.text },
        stop,
      );
      if (answer === stop) await setMemoryStatus(node, "stopped");
    }),
    command("bria.memory.reveal", async (node?: MemoryNode) => {
      if (node?.kind !== "item" || !node.item.sourceMessageId) return;
      if (!(await chat.reveal(node.item.sourceMessageId))) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t("This message is further back in the chat. Load older messages to see it."),
        );
      }
    }),
    command("bria.memory.openDocument", async () => {
      if (!memory.projectId) return;
      await vscode.commands.executeCommand(
        "markdown.showPreview",
        MemoryDocumentProvider.uri(memory.projectId),
      );
    }),
    command("bria.memory.refresh", () => memory.refresh()),

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
