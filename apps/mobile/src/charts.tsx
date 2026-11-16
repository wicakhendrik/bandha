import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import type { CashflowMonth, HistoryPoint } from "@bandha/api-client";
import { monthLabel, rp } from "@bandha/api-client";
import { useT } from "./i18n";
import { SLICE, useTheme } from "./theme";
import { T } from "./ui";

export function Sparkline({ points, height = 110 }: { points: HistoryPoint[]; height?: number }) {
  const t = useT();
  const W = 300;
  const vals = points.map((p) => Number(p.netWorth));
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const xy = vals.map((v, i) => [(i / (vals.length - 1)) * W, height - 14 - ((v - min) / span) * (height - 28)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1]!;
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" accessibilityLabel={t("Grafik kekayaan bersih", "Net worth chart")}>
      <Defs>
        <LinearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F0BE5A" stopOpacity={0.45} /><Stop offset="1" stopColor="#F0BE5A" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={`${line} L${W} ${height} L0 ${height}Z`} fill="url(#sp)" />
      <Path d={line} fill="none" stroke="#F4C970" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last[0]} cy={last[1]} r={4.5} fill="#FFE7B5" />
    </Svg>
  );
}

export function Donut({ slices, size = 140 }: { slices: Array<{ percent: number }>; size?: number }) {
  const c = useTheme();
  const t = useT();
  const r = 54, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" accessibilityLabel={t("Diagram alokasi aset", "Asset allocation chart")}>
      <Circle cx={70} cy={70} r={r} stroke={c.mori} strokeWidth={22} fill="none" />
      {slices.map((s, i) => {
        const len = (s.percent / 100) * C;
        // A circle's stroke starts at 3 o'clock. Shifting the dash by a quarter turn starts slices at 12 o'clock
        // without rotation/origin props, which are not valid DOM attributes on web.
        const offset = (((C / 4 - acc) % C) + C) % C;
        const el = (
          <Circle key={i} cx={70} cy={70} r={r} fill="none" stroke={SLICE[i % SLICE.length]} strokeWidth={22}
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={offset} />
        );
        acc += len;
        return el;
      })}
    </Svg>
  );
}

export function CashflowBars({ months }: { months: CashflowMonth[] }) {
  const c = useTheme();
  const t = useT();
  const max = Math.max(1, ...months.flatMap((m) => [Number(m.income), Number(m.expense)]));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 150, gap: 10 }} accessible accessibilityLabel={`${t(`Arus kas ${months.length} bulan.`, `Cash flow, ${months.length} months.`)} ${months.map((m) => t(`${monthLabel(m.month)} masuk ${rp(m.income)}, keluar ${rp(m.expense)}`, `${monthLabel(m.month)} in ${rp(m.income)}, out ${rp(m.expense)}`)).join(". ")}`}>
      {months.map((m) => (
        <View key={m.month} style={{ flex: 1, alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
          <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end", flex: 1 }}>
            <View style={{ width: 11, minHeight: 2, height: `${(Number(m.income) / max) * 100}%`, backgroundColor: c.daun, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />
            <View style={{ width: 11, minHeight: 2, height: `${(Number(m.expense) / max) * 100}%`, backgroundColor: c.gold, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />
          </View>
          <T v="small" muted>{monthLabel(m.month)}</T>
        </View>
      ))}
    </View>
  );
}
