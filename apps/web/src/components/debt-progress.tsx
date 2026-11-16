"use client";
import type { Debt } from "@bandha/api-client";
import { useI18n } from "@/lib/i18n";

export function DebtProgress({ debt }: { debt: Debt }) {
  const { t } = useI18n();
  const pct = Math.round(debt.progress);
  return (
    <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("debt.progressAria", { pct })}>
      <i className={debt.direction} style={{ width: `${Math.max(debt.progress, debt.status === "settled" ? 100 : 2)}%` }} />
    </div>
  );
}
