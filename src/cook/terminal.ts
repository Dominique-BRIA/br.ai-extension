import * as vscode from "vscode";

/**
 * Terminal « <br/> · cuisinier » : montre en direct ce que fait le cuisinier sur cette
 * machine (fichiers lus et modifiés, commandes lancées et leur sortie). Il est en lecture
 * seule ; on peut le fermer et le rouvrir à tout moment.
 */
export class CookTerminal implements vscode.Disposable {
  readonly #writeEmitter = new vscode.EventEmitter<string>();
  #terminal: vscode.Terminal | undefined;
  #open = false;
  /** Ce qui a été écrit avant l'ouverture, rejoué à l'ouverture. */
  #backlog = "";
  readonly #subscription: vscode.Disposable;

  constructor() {
    this.#subscription = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === this.#terminal) {
        this.#terminal = undefined;
        this.#open = false;
      }
    });
  }

  /** Affiche le terminal, sans lui donner le focus. */
  show(preserveFocus = true): void {
    if (!this.#terminal) {
      const pty: vscode.Pseudoterminal = {
        onDidWrite: this.#writeEmitter.event,
        open: () => {
          this.#open = true;
          this.#writeEmitter.fire(
            `\x1b[2m${vscode.l10n.t("What the <br/> cook does on this machine appears here. You can close this terminal at any time.")}\x1b[0m\r\n\r\n`,
          );
          if (this.#backlog) this.#writeEmitter.fire(this.#backlog);
          this.#backlog = "";
        },
        close: () => {
          this.#open = false;
        },
      };
      this.#terminal = vscode.window.createTerminal({
        name: vscode.l10n.t("<br/> · cook"),
        pty,
        iconPath: new vscode.ThemeIcon("tools"),
      });
    }
    this.#terminal.show(preserveFocus);
  }

  /** Une étape (fichier lu ou modifié, refus…), sur une ligne. */
  step(text: string): void {
    this.#write(`\x1b[2m${time()}\x1b[0m ${text}\r\n`);
  }

  /** Début d'une commande : la commande et le dossier. */
  commandStarted(command: string, folder: string): void {
    this.#write(`\r\n\x1b[2m${time()} ${folder}\x1b[0m\r\n\x1b[1m> ${command}\x1b[0m\r\n`);
  }

  /** Sortie de la commande, au fil de l'eau. */
  output(chunk: string): void {
    this.#write(chunk.replace(/\r?\n/g, "\r\n"));
  }

  commandEnded(code: number | null): void {
    const color = code === 0 ? "\x1b[32m" : "\x1b[31m";
    this.#write(`\r\n${color}${vscode.l10n.t("Exit code: {0}", String(code))}\x1b[0m\r\n`);
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#terminal?.dispose();
    this.#writeEmitter.dispose();
  }

  #write(text: string): void {
    if (this.#open) this.#writeEmitter.fire(text);
    else this.#backlog = (this.#backlog + text).slice(-50_000);
  }
}

function time(): string {
  return new Date().toLocaleTimeString(vscode.env.language);
}
