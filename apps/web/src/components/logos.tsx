import { accountBadge, brandBadge, coinSpec, type BadgeSpec, type Brand } from "@bandha/api-client";

/** Font size that fits a badge mark of the given length inside the 32-unit box. */
const markSize = (n: number) => (n <= 1 ? 18 : n === 2 ? 15 : n === 3 ? 12 : n === 4 ? 10 : 8.5);

function Badge({ spec, size, label }: { spec: BadgeSpec; size: number; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label} style={{ flex: "none", display: "block" }}>
      <rect width="32" height="32" rx="8" fill={spec.bg} />
      {spec.glyph ? (
        <svg x="5" y="5" width="22" height="22" viewBox="0 0 24 24"><path d={spec.glyph.path} fill={spec.fg} /></svg>
      ) : (
        <text x="16" y="16" dy=".35em" textAnchor="middle" fontSize={markSize(spec.mark.length)} fontWeight="700" fill={spec.fg}
          fontFamily="var(--font-sans), system-ui, sans-serif">{spec.mark}</text>
      )}
    </svg>
  );
}

/** Logo of an account: its chosen brand, else guessed from its name, else a monogram by account kind. */
export function AccountLogo({ account, size = 40 }: { account: { brandKey?: string | null; name: string; kind: string }; size?: number }) {
  return <Badge spec={accountBadge(account)} size={size} label={account.name} />;
}

/** Logo of a catalog brand (used by the brand picker). */
export function BrandLogo({ brand, size = 40 }: { brand: Brand; size?: number }) {
  return <Badge spec={brandBadge(brand)} size={size} label={brand.name} />;
}

/** Coin / currency mark: a real vector icon where an open set has one, otherwise a coloured badge. */
export function CoinLogo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const spec = coinSpec(symbol);
  if (spec.type === "badge") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={symbol} style={{ flex: "none", display: "block" }}>
        <circle cx="16" cy="16" r="16" fill={spec.bg} />
        <text x="16" y="16" dy=".35em" textAnchor="middle" fontSize={markSize(spec.mark.length)} fontWeight="700" fill={spec.fg}
          fontFamily="var(--font-sans), system-ui, sans-serif">{spec.mark}</text>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={symbol} style={{ flex: "none", display: "block" }}>
      <circle cx="16" cy="16" r="16" fill={spec.bg} />
      {spec.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? "#FFFFFF"} fillRule={p.evenodd ? "evenodd" : "nonzero"} opacity={p.opacity} />
      ))}
    </svg>
  );
}
