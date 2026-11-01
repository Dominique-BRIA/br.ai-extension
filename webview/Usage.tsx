import type { TeamUsage } from "@br-ia/protocol";
import { useEffect } from "react";
import type { ChatStrings } from "../src/webviewMessages";
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
      <p className="meta">
        {strings.planLimits
          .replace("{0}", String(usage.plan.maxMembers))
          .replace("{1}", String(usage.plan.maxProjects))}{" "}
        · {strings.betaFree}
      </p>
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
