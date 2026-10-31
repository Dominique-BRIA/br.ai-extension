import type { RequestCodeResponse, User, VerifyCodeResponse } from "@br-ia/protocol";
import * as vscode from "vscode";
import { type Api, ApiRequestError } from "./api";

const TOKEN_KEY = "bria.sessionToken";
const USER_KEY = "bria.user";

/**
 * La session du membre sur cette machine. Le jeton est rangé dans le coffre
 * de VS Code (SecretStorage), jamais dans les réglages.
 */
export class Session implements vscode.Disposable {
  readonly #onDidChange = new vscode.EventEmitter<User | undefined>();
  readonly onDidChange = this.#onDidChange.event;
  #token: string | undefined;
  #user: User | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async restore(): Promise<void> {
    this.#token = await this.context.secrets.get(TOKEN_KEY);
    this.#user = this.#token ? this.context.globalState.get<User>(USER_KEY) : undefined;
    void this.#publish();
  }

  get token(): string | undefined {
    return this.#token;
  }

  get user(): User | undefined {
    return this.#user;
  }

  async signedIn(token: string, user: User): Promise<void> {
    this.#token = token;
    this.#user = user;
    await this.context.secrets.store(TOKEN_KEY, token);
    await this.context.globalState.update(USER_KEY, user);
    await this.#publish();
  }

  async clear(): Promise<void> {
    if (!this.#token) return;
    this.#token = undefined;
    this.#user = undefined;
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.globalState.update(USER_KEY, undefined);
    await this.#publish();
  }

  dispose(): void {
    this.#onDidChange.dispose();
  }

  async #publish(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "bria.signedIn", Boolean(this.#token));
    this.#onDidChange.fire(this.#user);
  }
}

/**
 * Connexion par e-mail, avec les zones de saisie natives de VS Code :
 * e-mail, code d'invitation si le compte n'existe pas, nom affiché, puis code reçu.
 */
export async function signInFlow(api: Api, session: Session, machineId: string): Promise<void> {
  const email = await vscode.window.showInputBox({
    title: vscode.l10n.t("Sign in to br.ia"),
    prompt: vscode.l10n.t("Your email address. We will send you a sign-in code."),
    placeHolder: "nom@exemple.org",
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : vscode.l10n.t("Enter a valid email address."),
  });
  if (!email) return;

  let invitationCode: string | undefined;
  let requested: RequestCodeResponse | undefined;
  while (!requested) {
    try {
      requested = await api.post<RequestCodeResponse>("/auth/code", { email, invitationCode });
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      if (error.code === "too_many_requests") {
        // Un code a déjà été envoyé il y a moins d'une minute : on passe à sa saisie.
        requested = { newAccount: false };
        break;
      }
      if (error.code !== "invitation_required" && error.code !== "invitation_invalid") throw error;
      if (error.code === "invitation_invalid") {
        void vscode.window.showWarningMessage(vscode.l10n.t("This invitation code is not valid."));
      }
      invitationCode = await vscode.window.showInputBox({
        title: vscode.l10n.t("Invitation code"),
        prompt: vscode.l10n.t("br.ia is in private beta. Enter the invitation code you received."),
        placeHolder: "BETA-XXXX-XXXX",
        ignoreFocusOut: true,
      });
      if (!invitationCode) return;
    }
  }

  let displayName: string | undefined;
  if (requested.newAccount) {
    displayName = await vscode.window.showInputBox({
      title: vscode.l10n.t("Your name"),
      prompt: vscode.l10n.t("The name your team will see."),
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("Enter a name.")),
    });
    if (!displayName) return;
  }

  for (;;) {
    const code = await vscode.window.showInputBox({
      title: vscode.l10n.t("Sign-in code"),
      prompt: vscode.l10n.t("Enter the 6-digit code sent to {0}.", email),
      placeHolder: "123456",
      ignoreFocusOut: true,
      validateInput: (value) => (/^\d{6}$/.test(value.trim()) ? undefined : vscode.l10n.t("6 digits.")),
    });
    if (!code) return;
    try {
      const result = await api.post<VerifyCodeResponse>("/auth/verify", {
        email,
        code,
        machineId,
        displayName,
      });
      await session.signedIn(result.token, result.user);
      void vscode.window.showInformationMessage(vscode.l10n.t("Signed in as {0}.", result.user.displayName));
      return;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "code_invalid") {
        void vscode.window.showWarningMessage(vscode.l10n.t("Incorrect code. Try again."));
        continue;
      }
      throw error;
    }
  }
}
