import { CalendarDays, TrendingUp, Repeat2 } from "lucide-react";
export type FinancialTarget = {
  currency: string;
  upfront: number;
  completion: number;
  conditional: number;
  basis: string;
};
export const profitFrequency: Record<string, string> = {
  project: "one time",
  occurrence: "per occurrence",
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  half_year: "every 6 months",
  year: "yearly",
};
export function PlanSummary({
  plan,
}: {
  plan: { target_date?: string; financial_target?: FinancialTarget | null };
}) {
  const f = plan.financial_target,
    recurring = !!f && f.basis !== "project";
  return (
    <div className="plan-summary" aria-label="Deadline and expected profit">
      {recurring ? (
        <span className="plan-summary-item">
          <Repeat2 size={14} />
          <span>
            <small>Cycle</small>
            <strong>{profitFrequency[f.basis] || "Repeating"}</strong>
          </span>
        </span>
      ) : (
        <span className="plan-summary-item">
          <CalendarDays size={14} />
          <span>
            <small>Deadline</small>
            <strong>
              {plan.target_date
                ? new Date(plan.target_date + "T12:00:00").toLocaleDateString(
                    undefined,
                    { day: "numeric", month: "short", year: "numeric" },
                  )
                : "Not set"}
            </strong>
          </span>
        </span>
      )}
      <span
        className="plan-summary-item"
        title="Estimated profit: upfront plus completion. Conditional rewards remain separate."
      >
        <TrendingUp size={14} />
        <span>
          <small>
            Est. profit{f ? " · " + (profitFrequency[f.basis] || f.basis) : ""}
          </small>
          <strong>
            {f
              ? `${f.currency} ${((Number(f.upfront) + Number(f.completion)) / 100).toLocaleString()}`
              : "Not set"}
          </strong>
        </span>
      </span>
    </div>
  );
}
