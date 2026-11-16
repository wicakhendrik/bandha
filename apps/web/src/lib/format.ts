// Display helpers are shared with the mobile app (deterministic, no Intl) via @bandha/api-client, and follow the selected language.
export {
  ACCOUNT_FILTERS, ACCOUNT_KIND_LABEL, DEBT_KINDS, debtKindLabel, KIND_LABEL, accountKindLabel, assetKindLabel, categoryLabel, dateShort, initials, isAmount, isAmountOrZero,
  ledgerRowView, monthLabel, monthYear, pct, qty, rp, shiftMonth, signedRp, todayKey, txTypeLabel,
} from "@bandha/api-client";
