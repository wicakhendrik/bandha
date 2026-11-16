import { View } from "react-native";
import type { Debt } from "@bandha/api-client";
import { useT } from "./i18n";
import { useTheme } from "./theme";

export function ProgressBar({ debt }: { debt: Debt }) {
  const c = useTheme();
  const t = useT();
  const pct = Math.max(debt.progress, debt.status === "settled" ? 100 : 2);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t(`${Math.round(debt.progress)}% selesai`, `${Math.round(debt.progress)}% settled`)} style={{ height: 8, borderRadius: 99, backgroundColor: c.mori, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", borderRadius: 99, backgroundColor: debt.direction === "payable" ? c.gold : c.pos }} />
    </View>
  );
}
