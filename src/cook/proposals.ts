import * as vscode from "vscode";

interface Proposal {
  content: string;
  resolve: (accepted: boolean) => void;
}

/**
 * Validation d'une modification proposée par le cuisinier : la vue avant/après native
 * de VS Code, avec « Accepter » et « Refuser » dans la barre de l'éditeur et dans une notification.
 */
export class ProposalReview implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = "bria-proposal";
  readonly #proposals = new Map<string, Proposal>();
  readonly #registration: vscode.Disposable;

  constructor() {
    this.#registration = vscode.workspace.registerTextDocumentContentProvider(ProposalReview.scheme, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = new URLSearchParams(uri.query).get("id") ?? "";
    if (id === "empty") return "";
    return this.#proposals.get(id)?.content ?? "";
  }

  /** Montre la modification et attend la décision du membre. */
  async review(options: {
    id: string;
    title: string;
    file: vscode.Uri;
    exists: boolean;
    proposed: string;
  }): Promise<boolean> {
    const decision = new Promise<boolean>((resolve) => {
      this.#proposals.set(options.id, { content: options.proposed, resolve });
    });
    const right = vscode.Uri.from({
      scheme: ProposalReview.scheme,
      path: options.file.path,
      query: `id=${options.id}`,
    });
    const left = options.exists
      ? options.file
      : vscode.Uri.from({ scheme: ProposalReview.scheme, path: options.file.path, query: "id=empty" });
    await vscode.commands.executeCommand("vscode.diff", left, right, options.title, { preview: false });

    const accept = vscode.l10n.t("Accept");
    const reject = vscode.l10n.t("Reject");
    void vscode.window.showInformationMessage(options.title, accept, reject).then((choice) => {
      if (choice) this.decide(options.id, choice === accept);
    });

    const accepted = await decision;
    await this.#close(right);
    return accepted;
  }

  /** Décision prise depuis la barre de l'éditeur ou la notification. */
  decide(id: string, accepted: boolean): void {
    const proposal = this.#proposals.get(id);
    if (!proposal) return;
    this.#proposals.delete(id);
    proposal.resolve(accepted);
  }

  /** Identifiant de la proposition affichée dans un éditeur. */
  static idOf(uri: vscode.Uri | undefined): string | undefined {
    if (uri?.scheme !== ProposalReview.scheme) return undefined;
    const id = new URLSearchParams(uri.query).get("id");
    return id && id !== "empty" ? id : undefined;
  }

  /** Refuse toutes les propositions en attente (commande arrêtée, extension fermée). */
  rejectAll(): void {
    for (const id of [...this.#proposals.keys()]) this.decide(id, false);
  }

  dispose(): void {
    this.rejectAll();
    this.#registration.dispose();
  }

  async #close(uri: vscode.Uri): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff && input.modified.toString() === uri.toString()) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }
}
