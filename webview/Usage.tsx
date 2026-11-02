import type { TeamUsage } from "@br-ia/protocol";
import { type FormEvent, useEffect, useState } from "react";
import type { ChatStrings, ToWebview } from "../src/webviewMessages";
import { post } from "./vscodeApi";

interface Props {
  usage: TeamUsage | undefined;
  isChef: boolean;
  strings: ChatStrings;
  locale: string;
}

/** La formule de l'équipe et les crédits consommés ce mois-ci (par membre pour le chef). */
export function UsageCard({ usage, isChef, strings, locale }: Props) {
  useEffect(() => {
    if (usage === undefined) post({ type: "usage" });
  }, [usage]);

  if (!usage) return null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const ratio = usage.quota > 0 ? Math.min(usage.used / usage.quota, 1) : 1;
  const level = ratio >= 1 ? "full" : ratio >= 0.8 ? "high" : "ok";

  return (
    <article className="usage-card">
      <div className="usage-head">
        <span className="codicon codicon-pulse" aria-hidden="true" />
        <span className="usage-plan">{strings.planTitle.replace("{0}", usage.plan.name)}</span>
        {usage.planEndsAt && (
          <span className="pill">
            {strings.planUntil.replace(
              "{0}",
              new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(usage.planEndsAt)),
            )}
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="icon-button"
          title={strings.refresh}
          aria-label={strings.refresh}
          onClick={() => post({ type: "usage" })}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
      <div
        className={`usage-track ${level}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={usage.quota}
        aria-valuenow={Math.round(usage.used)}
        aria-label={strings.creditsUsed
          .replace("{0}", number.format(usage.used))
          .replace("{1}", number.format(usage.quota))}
      >
        <div className="usage-bar" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="usage-line">
        <span>
          {strings.creditsUsed
            .replace("{0}", number.format(usage.used))
            .replace("{1}", number.format(usage.quota))}
          {usage.bonus > 0 && ` (${strings.bonusCredits.replace("{0}", number.format(usage.bonus))})`}
        </span>
        <span className="meta">{Math.round(ratio * 100)} %</span>
      </div>
      {usage.quota <= 0 && <p>{isChef ? strings.noCreditsChef : strings.noCreditsMember}</p>}
      <p className="meta">
        {strings.planLimits
          .replace("{0}", String(usage.plan.maxMembers))
          .replace("{1}", String(usage.plan.maxProjects))}{" "}
        · {strings.betaFree}
      </p>
      {isChef && <PromoEntry strings={strings} />}
      {isChef && usage.byMember.length > 0 && (
        <>
          <div className="field-label usage-members-title">{strings.usageByMember}</div>
          {usage.byMember.map((member) => (
            <div key={member.userId} className="usage-member">
              <span>{member.displayName}</span>
              <span className="meta">{number.format(member.credits)}</span>
            </div>
          ))}
        </>
      )}
    </article>
  );
}

/** Saisie d'un code promotionnel par le chef : formule offerte, crédits en bonus, essai… */
function PromoEntry({ strings }: { strings: ChatStrings }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type !== "promoResult") return;
      setBusy(false);
      setResult({ ok: event.data.ok, message: event.data.message });
      if (event.data.ok) {
        setCode("");
        setOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setResult(null);
    post({ type: "redeemPromo", code: code.trim() });
  };

  return (
    <div className="promo-entry">
      {result && (
        <p className={result.ok ? "saved" : "auth-error"} role="status">
          <span className={`codicon codicon-${result.ok ? "check" : "error"}`} aria-hidden="true" />
          {result.message}
        </p>
      )}
      {open ? (
        <form className="promo-form" onSubmit={submit}>
          <span className="field-box">
            <span className="codicon codicon-tag" aria-hidden="true" />
            <input
              className="mono"
              placeholder={strings.promoPlaceholder}
              aria-label={strings.enterCode}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </span>
          <button type="submit" className="primary-button" disabled={busy || !code.trim()}>
            {busy && <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />}
            {strings.apply}
          </button>
        </form>
      ) : (
        <button type="button" className="ghost-button" onClick={() => setOpen(true)}>
          <span className="codicon codicon-tag" aria-hidden="true" />
          {strings.enterCode}
        </button>
      )}
    </div>
  );
}
