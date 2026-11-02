import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChatStrings, ToWebview } from "../src/webviewMessages";
import { post } from "./vscodeApi";

type Step = "email" | "name" | "code";

interface Props {
  /** Le logo complet, en version claire et sombre. */
  wordmark: { light: string; dark: string };
  strings: ChatStrings;
}

/**
 * Connexion dans le panneau, comme une application : l'e-mail, le nom affiché si le
 * compte n'existe pas encore, puis le code reçu par e-mail.
 */
export function SignIn({ wordmark, strings }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Le compte n'existe pas encore : il faudra un nom. */
  const newAccount = useRef(false);
  /** Étape qui a envoyé la dernière demande de code (pour interpréter la réponse). */
  const resending = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: on place le curseur à chaque nouvelle étape.
  useEffect(() => {
    input.current?.focus();
  }, [step]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: les réponses lisent l'état courant par les refs et les setters.
  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type !== "authResult") return;
      setBusy(false);
      const explain = (failure: string | undefined, text: string | undefined) => {
        switch (failure) {
          case "network":
            return strings.serverUnreachable;
          case "invitation_invalid":
            return strings.invitationInvalid;
          case "code_invalid":
            return strings.codeInvalid;
          case "too_many_requests":
            return strings.codeAlreadySent;
          default:
            return text ?? strings.serverUnreachable;
        }
      };

      if (message.step === "requestCode") {
        if (message.ok) {
          if (message.newAccount) newAccount.current = true;
          setError(null);
          setNotice(resending.current ? strings.codeResent : null);
          setStep((current) => (current === "code" || !newAccount.current ? "code" : "name"));
        } else if (message.error === "too_many_requests") {
          // Un code est déjà parti : on passe à sa saisie (après le nom pour un nouveau compte).
          setError(null);
          setNotice(strings.codeAlreadySent);
          setStep((current) => (current === "code" || !newAccount.current ? "code" : "name"));
        } else {
          setError(explain(message.error, message.message));
        }
        resending.current = false;
        return;
      }

      // Connexion réussie : l'extension affiche l'accueil, rien d'autre à faire ici.
      if (!message.ok) {
        setError(explain(message.error, message.message));
        setCode("");
        input.current?.focus();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const requestCode = (again = false) => {
    resending.current = again;
    setBusy(true);
    setError(null);
    post({ type: "requestCode", email: email.trim() });
  };

  const verify = (value: string) => {
    setBusy(true);
    setError(null);
    post({
      type: "verifyCode",
      email: email.trim(),
      code: value,
      displayName: newAccount.current ? displayName.trim() : undefined,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (step) {
      case "email":
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
          setError(strings.invalidEmail);
          return;
        }
        newAccount.current = false;
        requestCode();
        return;
      case "name":
        if (displayName.trim()) {
          setError(null);
          setStep("code");
        }
        return;
      case "code":
        if (/^\d{6}$/.test(code)) verify(code);
        return;
    }
  };

  const restart = () => {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
    newAccount.current = false;
  };

  const titles: Record<Step, [string, string]> = {
    email: [strings.authWelcome, strings.authIntro],
    name: [strings.nameTitle, strings.nameIntro],
    code: [strings.codeTitle, strings.codeIntro.replace("{0}", email.trim())],
  };
  const [title, intro] = titles[step];
  const order: Step[] = newAccount.current ? ["email", "name", "code"] : ["email", "code"];

  return (
    <div className="auth">
      <div className="auth-hero">
        {/* La version affichée suit le thème de VS Code (feuille de style). */}
        <img className="logo-light" src={wordmark.light} alt="<br/> — Retour à la ligne" />
        <img className="logo-dark" src={wordmark.dark} alt="<br/> — Retour à la ligne" />
      </div>

      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-progress" aria-hidden="true">
          {order.map((item) => (
            <span key={item} className={order.indexOf(item) <= order.indexOf(step) ? "done" : ""} />
          ))}
        </div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-intro">{intro}</p>

        {step === "email" && (
          <label className="field">
            <span className="field-label">{strings.emailLabel}</span>
            <span className="field-box">
              <span className="codicon codicon-mail" aria-hidden="true" />
              <input
                ref={input}
                type="email"
                autoComplete="email"
                placeholder={strings.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </span>
          </label>
        )}

        {step === "name" && (
          <label className="field">
            <span className="field-label">{strings.nameLabel}</span>
            <span className="field-box">
              <span className="codicon codicon-account" aria-hidden="true" />
              <input
                ref={input}
                autoComplete="name"
                maxLength={60}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </span>
          </label>
        )}

        {step === "code" && (
          <label className="field">
            <span className="field-label">{strings.codeLabel}</span>
            <input
              ref={input}
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                if (digits.length === 6 && !busy) verify(digits);
              }}
            />
          </label>
        )}

        {error && (
          <p className="auth-error" role="alert">
            <span className="codicon codicon-error" aria-hidden="true" />
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="auth-notice" role="status">
            <span className="codicon codicon-info" aria-hidden="true" />
            {notice}
          </p>
        )}

        <button type="submit" className="primary-button wide auth-submit" disabled={busy}>
          {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
          {step === "email" ? strings.getCode : step === "code" ? strings.signInButton : strings.continue}
          {!busy && <span className="codicon codicon-arrow-right" aria-hidden="true" />}
        </button>

        {step === "code" && (
          <div className="auth-links">
            <button type="button" className="link" disabled={busy} onClick={() => requestCode(true)}>
              {strings.resendCode}
            </button>
            <button type="button" className="link" onClick={restart}>
              {strings.changeEmail}
            </button>
          </div>
        )}
        {step === "name" && (
          <div className="auth-links">
            <button type="button" className="link" onClick={restart}>
              <span className="codicon codicon-arrow-left" aria-hidden="true" />
              {strings.back}
            </button>
          </div>
        )}
      </form>

      <p className="auth-footer">
        <span className="codicon codicon-lock" aria-hidden="true" />
        {strings.authFooter}
      </p>
    </div>
  );
}
