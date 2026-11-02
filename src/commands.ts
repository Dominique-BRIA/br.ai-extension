import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { git } from "./cook/git";
import type { OrderNode, OrdersStore } from "./cook/orders";
import type { ProjectFolders } from "./cook/projectFolders";
import { ProposalReview } from "./cook/proposals";
import { installCommands, updateToLatest } from "./cook/update";
import { githubRepo, mergeBranch, parseRepo } from "./github";
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
      const repo = node.project.repo;
      if (repo) {
        const remote = parseRepo((await git(folder.fsPath, ["remote", "get-url", "origin"])).stdout);
        if (remote?.toLowerCase() !== repo.fullName.toLowerCase()) {
          const keep = vscode.l10n.t("Use it anyway");
          const answer = await vscode.window.showWarningMessage(
            vscode.l10n.t("This folder is not a clone of {0}, the repository of the project.", repo.fullName),
            { modal: true },
            keep,
          );
          if (answer !== keep) return;
        }
      }
      await folders.set(node.project.id, folder.fsPath);
      void vscode.window.showInformationMessage(
        vscode.l10n.t("The cook can now work on {0} in {1}.", node.project.name, folder.fsPath),
      );
    }),
    command("bria.linkRepo", async (node?: TeamsNode) => {
      if (node?.kind !== "project") return;
      const { project } = node;
      const folder = folders.get(project.id);
      let suggestion = project.repo?.fullName ?? "";
      if (!suggestion && folder) {
        const remote = await git(folder, ["remote", "get-url", "origin"]);
        suggestion = parseRepo(remote.stdout) ?? "";
      }
      const input = await vscode.window.showInputBox({
        title: vscode.l10n.t("GitHub repository of {0}", project.name),
        prompt: vscode.l10n.t("owner/name, or the address of the repository. Leave empty to unlink it."),
        value: suggestion,
        validateInput: (value) =>
          !value.trim() || parseRepo(value) ? undefined : vscode.l10n.t("Expected format: owner/name"),
      });
      if (input === undefined) return;
      if (!input.trim()) {
        if (project.repo) await api.put(`/projects/${project.id}/repo`, { repo: null });
        return;
      }
      const fullName = parseRepo(input);
      if (!fullName) return;
      let repo: Awaited<ReturnType<typeof githubRepo>>;
      try {
        repo = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("Checking {0} on GitHub…", fullName),
          },
          () => githubRepo(fullName),
        );
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
        return;
      }
      await api.put(`/projects/${project.id}/repo`, {
        repo: { fullName: repo.fullName, defaultBranch: repo.defaultBranch },
      });
      if (folder) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            "{0} is linked to {1}. Each order of the cook will work on its own branch.",
            repo.fullName,
            project.name,
          ),
        );
        return;
      }
      const clone = vscode.l10n.t("Clone it");
      const answer = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          "{0} is linked to {1}. Clone it on this machine so the cook can work on it?",
          repo.fullName,
          project.name,
        ),
        clone,
      );
      if (answer === clone)
        await vscode.commands.executeCommand("bria.cloneRepo", { ...node, project: { ...project, repo } });
    }),
    command("bria.cloneRepo", async (node?: TeamsNode) => {
      if (node?.kind !== "project" || !node.project.repo) return;
      const { project } = node;
      const repo = node.project.repo;
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t("Clone here"),
        title: vscode.l10n.t("Where to clone {0}?", repo.fullName),
      });
      const parent = picked?.[0]?.fsPath;
      if (!parent) return;
      const target = join(parent, repo.fullName.split("/")[1] ?? "depot");
      if (existsSync(target)) {
        void vscode.window.showErrorMessage(vscode.l10n.t("The folder {0} already exists.", target));
        return;
      }
      const cloned = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Cloning {0}…", repo.fullName),
        },
        () => git(parent, ["clone", `https://github.com/${repo.fullName}.git`, target], 600_000),
      );
      if (cloned.code !== 0) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t("Cloning failed: {0}", (cloned.stderr || cloned.stdout).split("\n")[0] ?? ""),
        );
        return;
      }
      await folders.set(project.id, target);
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          "{0} is cloned in {1}. The cook can now work on {2}.",
          repo.fullName,
          target,
          project.name,
        ),
      );
    }),
    command("bria.updateProject", async (node?: TeamsNode) => {
      if (node?.kind !== "project" || !node.project.repo) return;
      const { project } = node;
      const { defaultBranch } = node.project.repo;
      const folder = folders.get(project.id);
      if (!folder) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t("No folder is linked to this project on this machine."),
        );
        return;
      }
      // Changer de branche sous les pieds du cuisinier casserait son travail.
      if (executor.busyOrder) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t("The cook is working on this machine. Update once the order is finished."),
        );
        return;
      }
      const run = (stash: boolean) =>
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("Updating {0}…", project.name),
          },
          () => updateToLatest(folder, defaultBranch, stash),
        );
      let outcome = await run(false);
      if (outcome.status === "dirty") {
        const stash = vscode.l10n.t("Set aside and update");
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t("The folder has unsaved changes. What should the cook do?"),
          {
            modal: true,
            detail: vscode.l10n.t(
              "Your changes can be set aside, then reapplied on the new version. You can also save them yourself and update later.",
            ),
          },
          stash,
        );
        if (answer !== stash) return;
        outcome = await run(true);
      }
      if (outcome.status === "failed") {
        void vscode.window.showErrorMessage(vscode.l10n.t("Update failed: {0}", outcome.message));
        return;
      }
      if (outcome.status === "other-branch") {
        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            "{0} is up to date, but you stay on your branch {1}. Merge {0} into it when you are ready.",
            defaultBranch,
            outcome.branch,
          ),
        );
        return;
      }
      if (outcome.status !== "updated") return;
      const installs = installCommands(folder, outcome.changedFiles);
      for (const { dir, command: install } of installs) {
        const terminal = vscode.window.createTerminal({
          name: vscode.l10n.t("<br/> · dependencies"),
          cwd: join(folder, dir),
        });
        terminal.show(true);
        terminal.sendText(install);
      }
      if (outcome.stashConflict) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t(
            "{0} is updated, but your changes conflict with the new version: resolve the conflicts. They also remain in git stash.",
            project.name,
          ),
        );
        return;
      }
      void vscode.window.showInformationMessage(
        outcome.changedFiles.length === 0
          ? vscode.l10n.t("{0} is already up to date.", project.name)
          : installs.length > 0
            ? vscode.l10n.t(
                "{0} is updated. New dependencies are being installed in the terminal.",
                project.name,
              )
            : vscode.l10n.t("{0} is updated.", project.name),
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
    command("bria.order.relay", async (node?: OrderNode) => {
      if (node?.kind !== "order") return;
      const relay = vscode.l10n.t("Pass it on");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Pass order {0} on to another machine?", node.order.number),
        {
          modal: true,
          detail: vscode.l10n.t(
            "The cook finishes its current step, pushes its work to GitHub and leaves a handoff note. The next available machine resumes it.",
          ),
        },
        relay,
      );
      if (answer !== relay) return;
      await api.post(`/orders/${node.order.id}/relay`);
      await orders.refresh();
    }),
    command("bria.order.push", async (node?: OrderNode) => {
      if (node?.kind !== "order" || !node.order.branch) return;
      const { order } = node;
      const branch = node.order.branch;
      const folder = folders.get(order.projectId);
      if (!folder) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t("No folder is linked to this project on this machine."),
        );
        return;
      }
      const pushed = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Pushing {0}…", branch) },
        () => git(folder, ["push", "--set-upstream", "origin", branch], 300_000),
      );
      if (pushed.code !== 0) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t("Push failed: {0}", (pushed.stderr || pushed.stdout).split("\n")[0] ?? ""),
        );
        return;
      }
      await api.post(`/orders/${order.id}/pushed`);
      await orders.refresh();
    }),
    command("bria.order.validate", async (node?: OrderNode) => {
      if (node?.kind !== "order" || !node.order.branch) return;
      const { order } = node;
      const branch = node.order.branch;
      const repo = store.project(order.projectId)?.project.repo;
      if (!repo) {
        void vscode.window.showErrorMessage(vscode.l10n.t("This project no longer has a GitHub repository."));
        return;
      }
      const validate = vscode.l10n.t("Validate and merge");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Validate order {0} and merge {1} into {2}?", order.number, branch, repo.defaultBranch),
        {
          modal: true,
          detail: vscode.l10n.t("A pull request is opened and merged with your GitHub account."),
        },
        validate,
      );
      if (answer !== validate) return;
      const outcome = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Merging {0}…", branch) },
        () =>
          mergeBranch(repo.fullName, {
            branch,
            base: repo.defaultBranch,
            title: order.title,
            body: `Commande n° ${order.number}.\n\n${order.summary ?? ""}`.trim(),
          }),
      );
      if (outcome.merged) orders.markMergedHere(order.id);
      await api.put(`/orders/${order.id}/pull-request`, { number: outcome.number, merged: outcome.merged });
      await orders.refresh();
      if (outcome.merged) {
        const found = store.project(order.projectId);
        const update = vscode.l10n.t("Update");
        const text = vscode.l10n.t("Order {0} is merged into {1}.", order.number, repo.defaultBranch);
        const picked = await (found && folders.get(order.projectId)
          ? vscode.window.showInformationMessage(text, update)
          : vscode.window.showInformationMessage(text));
        if (picked === update && found) {
          await vscode.commands.executeCommand("bria.updateProject", { kind: "project", ...found });
        }
        return;
      }
      const openIt = vscode.l10n.t("Open the pull request");
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Pull request {0} is open, but GitHub refuses the merge: {1}",
          outcome.number,
          outcome.reason ?? "",
        ),
        openIt,
      );
      if (choice === openIt) await vscode.env.openExternal(vscode.Uri.parse(outcome.url));
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
