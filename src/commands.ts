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
import type { Checkpoints } from "./cook/checkpoints";
import type { CookExecutor, PermissionMode } from "./cook/executor";
import type { OrderNode, OrdersStore } from "./cook/orders";
import type { ProjectFolders } from "./cook/projectFolders";
import { ProposalReview } from "./cook/proposals";
import type { MemoryStore } from "./memoryStore";
import { MemoryDocumentProvider, type MemoryNode } from "./memoryView";
import type { Session } from "./session";
import type { TeamsNode } from "./teamsView";
import type { WorkspaceStore } from "./workspaceStore";

interface Deps {
  api: Api;
  session: Session;
  connection: Connection;
  store: WorkspaceStore;
  chat: ChatViewProvider;
  memory: MemoryStore;
  folders: ProjectFolders;
  orders: OrdersStore;
  executor: CookExecutor;
  proposals: ProposalReview;
  checkpoints: Checkpoints;
  log: vscode.LogOutputChannel;
}

/** Enregistre les commandes de l'extension. Les erreurs du serveur sont affichées à la personne. */
export function registerCommands(deps: Deps): vscode.Disposable[] {
  const {
    api,
    session,
    connection,
    store,
    chat,
    memory,
    log,
    folders,
    orders,
    executor,
    proposals,
    checkpoints,
  } = deps;

  /** Proposition affichée dans l'onglet actif (vue avant/après). */
  const activeProposal = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff ? ProposalReview.idOf(input.modified) : undefined;
  };

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
            ? vscode.l10n.t("The <br/> server cannot be reached.")
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
    // La connexion se fait dans le panneau : on l'affiche.
    command("bria.signIn", () => chat.show()),

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
        title: vscode.l10n.t("Language of the emails <br/> sends you"),
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
        { modal: true, detail: vscode.l10n.t("This machine will need to sign in again to use <br/>.") },
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
        vscode.l10n.t("Delete your <br/> account?"),
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
        title: vscode.l10n.t("Delete your <br/> account"),
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
    command("bria.memory.add", async () => {
      const projectId = memory.projectId;
      if (!projectId) return;
      const types = [
        { label: `$(law) ${vscode.l10n.t("Decision")}`, type: "decision" },
        { label: `$(question) ${vscode.l10n.t("Open question")}`, type: "question" },
        { label: `$(tasklist) ${vscode.l10n.t("Task")}`, type: "task" },
      ] as const;
      const picked = await vscode.window.showQuickPick(types, { title: vscode.l10n.t("New note") });
      if (!picked) return;
      const text = await vscode.window.showInputBox({
        title: vscode.l10n.t("New note"),
        prompt: vscode.l10n.t("Short and self-contained: the whole team will read it."),
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("Enter a text.")),
      });
      if (!text) return;
      await api.post(`/projects/${projectId}/memory`, { type: picked.type, text: text.trim() });
      await memory.refresh();
    }),
    command("bria.memory.openDocument", async () => {
      if (!memory.projectId) return;
      await vscode.commands.executeCommand(
        "markdown.showPreview",
        MemoryDocumentProvider.uri(memory.projectId),
      );
    }),
    command("bria.memory.refresh", () => memory.refresh()),

    command("bria.linkFolder", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        openLabel: vscode.l10n.t("Use this folder"),
        title: vscode.l10n.t("Folder of {0} on this machine", node.project.name),
      });
      const folder = picked?.[0];
      if (!folder) return;
      await folders.set(node.project.id, folder.fsPath);
      void vscode.window.showInformationMessage(
        vscode.l10n.t("The cook can now work on {0} in {1}.", node.project.name, folder.fsPath),
      );
    }),
    command("bria.unlinkFolder", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      await folders.set(node.project.id, undefined);
    }),

    command("bria.setPermissionMode", async () => {
      const settings = vscode.workspace.getConfiguration("bria");
      const current = settings.get<PermissionMode>("permissionMode", "manual");
      const modes: { label: string; detail: string; mode: PermissionMode }[] = [
        {
          label: vscode.l10n.t("Manual"),
          detail: vscode.l10n.t("You approve each change (side-by-side view) and each command."),
          mode: "manual",
        },
        {
          label: vscode.l10n.t("Auto edit"),
          detail: vscode.l10n.t("Changes are applied directly; you approve each command."),
          mode: "autoEdit",
        },
        {
          label: vscode.l10n.t("Auto"),
          detail: vscode.l10n.t("Changes and commands run directly, except risky commands."),
          mode: "auto",
        },
        {
          label: vscode.l10n.t("Plan"),
          detail: vscode.l10n.t("The cook reads and proposes, but changes nothing on this machine."),
          mode: "plan",
        },
      ];
      const picked = await vscode.window.showQuickPick(
        modes.map((item) => ({
          ...item,
          description: item.mode === current ? vscode.l10n.t("current") : undefined,
        })),
        { title: vscode.l10n.t("What the cook may do on this machine") },
      );
      if (picked) await settings.update("permissionMode", picked.mode, vscode.ConfigurationTarget.Global);
    }),

    command("bria.toggleLending", async () => {
      const settings = vscode.workspace.getConfiguration("bria");
      const lending = !settings.get<boolean>("lendMachine", false);
      await settings.update("lendMachine", lending, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        lending
          ? vscode.l10n.t("Your machine is lent: the cook may work here on your teammates' orders.")
          : vscode.l10n.t("Your machine is no longer lent: the cook only works here on your own orders."),
      );
    }),

    command("bria.order.stop", async (node?: OrderNode) => {
      if (node?.kind !== "order") return;
      await api.post(`/orders/${node.order.id}/stop`);
      await orders.refresh();
    }),
    command("bria.order.stopCurrent", async () => {
      const orderId = executor.busyOrder;
      if (!orderId) return;
      proposals.rejectAll();
      await api.post(`/orders/${orderId}/stop`);
      executor.orderFinished(orderId);
    }),
    command("bria.order.revert", async (node?: OrderNode) => {
      if (node?.kind !== "order") return;
      const revert = vscode.l10n.t("Undo changes");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Undo the changes made by order {0} on this machine?", node.order.number),
        { modal: true, detail: vscode.l10n.t("Each file goes back to its state before the order.") },
        revert,
      );
      if (answer !== revert) return;
      const files = await checkpoints.revert(node.order.id);
      await orders.refresh();
      void vscode.window.showInformationMessage(vscode.l10n.t("{0} file(s) restored.", files.length));
    }),
    command("bria.orders.refresh", () => orders.refresh()),

    command("bria.proposal.accept", () => {
      const id = activeProposal();
      if (id) proposals.decide(id, true);
    }),
    command("bria.proposal.reject", () => {
      const id = activeProposal();
      if (id) proposals.decide(id, false);
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
