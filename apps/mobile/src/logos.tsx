import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { accountBadge, brandBadge, coinSpec, type BadgeSpec, type Brand } from "@bandha/api-client";
import { font } from "./theme";

/** Font size that fits a badge mark of the given length inside the 32-unit box. */
const markSize = (n: number) => (n <= 1 ? 18 : n === 2 ? 15 : n === 3 ? 12 : n === 4 ? 10 : 8.5);

// Text is centred by offsetting the baseline (react-native-svg has no dominant-baseline on every platform).
const baseline = (fs: number) => 16 + fs * 0.36;

function Badge({ spec, size, label }: { spec: BadgeSpec; size: number; label: string }) {
  const fs = markSize(spec.mark.length);
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel={label} accessibilityRole="image">
      <Rect width={32} height={32} rx={8} fill={spec.bg} />
      {spec.glyph ? (
        <Svg x={5} y={5} width={22} height={22} viewBox="0 0 24 24"><Path d={spec.glyph.path} fill={spec.fg} /></Svg>
      ) : (
        <SvgText x={16} y={baseline(fs)} fontSize={fs} fontWeight="700" fill={spec.fg} textAnchor="middle" fontFamily={font.sansBold}>{spec.mark}</SvgText>
      )}
    </Svg>
  );
}

/** Logo of an account: its chosen brand, else guessed from its name, else a monogram by account kind. */
export function AccountLogo({ account, size = 40 }: { account: { brandKey?: string | null; name: string; kind: string }; size?: number }) {
  return <Badge spec={accountBadge(account)} size={size} label={account.name} />;
}

export function BrandLogo({ brand, size = 40 }: { brand: Brand; size?: number }) {
  return <Badge spec={brandBadge(brand)} size={size} label={brand.name} />;
}

/** Coin / currency mark: a real vector icon where an open set has one, otherwise a coloured badge. */
export function CoinLogo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const spec = coinSpec(symbol);
  if (spec.type === "badge") {
    const fs = markSize(spec.mark.length);
    return (
      <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel={symbol} accessibilityRole="image">
        <Circle cx={16} cy={16} r={16} fill={spec.bg} />
        <SvgText x={16} y={baseline(fs)} fontSize={fs} fontWeight="700" fill={spec.fg} textAnchor="middle" fontFamily={font.sansBold}>{spec.mark}</SvgText>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel={symbol} accessibilityRole="image">
      <Circle cx={16} cy={16} r={16} fill={spec.bg} />
      {spec.paths.map((p, i) => (
        <Path key={i} d={p.d} fill={p.fill ?? "#FFFFFF"} fillRule={p.evenodd ? "evenodd" : "nonzero"} opacity={p.opacity} />
      ))}
    </Svg>
  );
}
