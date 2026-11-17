import type { ReactNode } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type ColorValue, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Pattern, Rect, Stop } from "react-native-svg";
import { font, useTheme } from "./theme";

/* ───── Icons ───── */
const PATHS = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16.5 14h.01",
  swap: "M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7",
  plus: "M12 5v14M5 12h14",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  x: "M18 6L6 18M6 6l12 12",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  edit: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  heart: "M12 20.5S3.5 15.3 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6c0 6.1-8.5 11.3-8.5 11.3z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.5 17.5 0 0 1-3.2 4.2M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.6-1",
} as const;

export function Icon({ name, size = 22, color }: { name: keyof typeof PATHS; size?: number; color: ColorValue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={PATHS[name]} />
    </Svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <G fill="none" stroke="#E2A93F" strokeWidth={2}>
        <Ellipse cx={20} cy={10} rx={6} ry={9.5} /><Ellipse cx={20} cy={30} rx={6} ry={9.5} />
        <Ellipse cx={10} cy={20} rx={9.5} ry={6} /><Ellipse cx={30} cy={20} rx={9.5} ry={6} />
      </G>
      <Rect x={17} y={17} width={6} height={6} rx={3} fill="#E2A93F" />
    </Svg>
  );
}

/** Gradient plus the kawung batik motif, drawn behind a card. */
export function BatikBackground({ colors = ["#4A2E1B", "#6B4428", "#8A5A32"], opacity = 0.14 }: { colors?: [string, string, string]; opacity?: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors[0]} /><Stop offset="0.55" stopColor={colors[1]} /><Stop offset="1" stopColor={colors[2]} />
        </LinearGradient>
        <Pattern id="kw" width={44} height={44} patternUnits="userSpaceOnUse">
          <G fill="none" stroke="#C58A2B" strokeWidth={1}>
            <Ellipse cx={22} cy={11} rx={6.5} ry={11} /><Ellipse cx={22} cy={33} rx={6.5} ry={11} />
            <Ellipse cx={11} cy={22} rx={11} ry={6.5} /><Ellipse cx={33} cy={22} rx={11} ry={6.5} />
          </G>
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#bg)" />
      <Rect width="100%" height="100%" fill="url(#kw)" opacity={opacity} />
    </Svg>
  );
}

/* ───── Text ───── */
type Variant = "title" | "heading" | "body" | "small" | "label" | "mono" | "monoBig";
const VARIANT: Record<Variant, TextStyle> = {
  title: { fontFamily: font.serif, fontSize: 26, lineHeight: 32 },
  heading: { fontFamily: font.serif, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.sansMedium, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: font.sans, fontSize: 12.5, lineHeight: 17 },
  label: { fontFamily: font.sansSemi, fontSize: 12.5, lineHeight: 16 },
  mono: { fontFamily: font.monoMedium, fontSize: 14, lineHeight: 20 },
  monoBig: { fontFamily: font.monoMedium, fontSize: 22, lineHeight: 28 },
};

export function T({ v = "body", muted, color, style, ...rest }: { v?: Variant; muted?: boolean; color?: string; style?: StyleProp<TextStyle>; children?: ReactNode; numberOfLines?: number; accessibilityRole?: "header" | "text" | "alert" }) {
  const c = useTheme();
  return <Text {...rest} style={[VARIANT[v], { color: color ?? (muted ? c.muted : c.ink) }, style]} />;
}

/* ───── Layout ───── */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 20, padding: 18 }, style]}>{children}</View>;
}

export function Screen({ children, onRefresh, refreshing = false, bottomPad = 0, scroll = true }: {
  children: ReactNode; onRefresh?: () => void; refreshing?: boolean; bottomPad?: number; scroll?: boolean;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 24 + bottomPad };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, pad]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[pad, { gap: 14 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.gold} colors={[c.gold]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomColor: c.line, borderBottomWidth: StyleSheet.hairlineWidth }, style]}>{children}</View>;
}

export function Avatar({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View accessible={false} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.onPrimary, fontFamily: font.sansBold, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/* ───── Controls ───── */
export function Btn({ label, onPress, kind = "pri", disabled, busy, small, accessibilityLabel, icon }: {
  label: string; onPress: () => void; kind?: "pri" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; small?: boolean; accessibilityLabel?: string;
  icon?: keyof typeof PATHS;
}) {
  const c = useTheme();
  const bg = kind === "pri" ? c.primary : "transparent";
  const fg = kind === "pri" ? c.onPrimary : kind === "danger" ? c.neg : c.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => ({
        backgroundColor: bg, borderColor: kind === "pri" ? c.primary : c.line, borderWidth: 1, borderRadius: small ? 10 : 14,
        paddingVertical: small ? 7 : 13, paddingHorizontal: small ? 12 : 18, alignItems: "center", justifyContent: "center",
        opacity: disabled || busy ? 0.55 : pressed ? 0.85 : 1, minHeight: small ? 34 : 48, flexDirection: "row", gap: 8,
      })}
    >
      {busy && <ActivityIndicator size="small" color={fg} />}
      {icon && !busy ? <Icon name={icon} size={small ? 15 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: font.sansSemi, fontSize: small ? 13 : 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & TextInputProps) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T v="label" muted>{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...input}
        style={{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, color: c.ink, fontFamily: font.sansMedium, fontSize: 15 }}
      />
      {hint ? <T v="small" muted>{hint}</T> : null}
    </View>
  );
}

export function Chips<K extends string>({ options, value, onChange, label }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T v="label" muted>{label}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityLabel={o.label} accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? c.gold : c.line, backgroundColor: on ? c.goldSoft : c.card }}>
              <Text style={{ color: on ? (c.ink) : c.muted, fontFamily: font.sansSemi, fontSize: 13 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A small tappable chip (quick-fill share, ready-made category). `on` marks it as chosen. */
export function Pill({ label, onPress, on, accessibilityLabel }: { label: string; onPress: () => void; on?: boolean; accessibilityLabel?: string }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: !!on }}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: on ? c.gold : c.line, backgroundColor: on ? c.goldSoft : c.card }}>
      <Text style={{ color: on ? c.ink : c.muted, fontFamily: font.sansSemi, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.mori, padding: 4, borderRadius: 14, gap: 4 }} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityLabel={o.label} accessibilityState={{ selected: o.key === value }}
          style={{ flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: "center", backgroundColor: o.key === value ? c.card : "transparent" }}>
          <Text style={{ fontFamily: font.sansSemi, fontSize: 13, color: o.key === value ? c.ink : c.muted }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ───── Feedback ───── */
export function Skeleton({ h = 18, w = "100%" }: { h?: number; w?: number | `${number}%` }) {
  const c = useTheme();
  return <View style={{ height: h, width: w, backgroundColor: c.mori, borderRadius: 10 }} />;
}

export function Banner({ tone, children }: { tone: "err" | "warn"; children: ReactNode }) {
  const c = useTheme();
  const err = tone === "err";
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: err ? "rgba(168,71,45,0.12)" : c.goldSoft, borderColor: err ? c.neg : c.gold, borderWidth: 1, borderRadius: 14, padding: 12 }}>
      <Text style={{ color: err ? c.neg : c.ink, fontFamily: font.sansMedium, fontSize: 13.5, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 24, gap: 6 }}>
      <T v="heading">{title}</T>
      {text ? <T v="small" muted style={{ textAlign: "center" }}>{text}</T> : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}
