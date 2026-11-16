import { dec, D, type Dec } from "./decimal";

/**
 * Weighted-average cost basis position for one (workspace, asset, account).
 * costBasis === null means the basis is UNKNOWN. It is never silently turned into 0.
 */
export interface Position {
  quantity: string;
  costBasis: string | null;
}

export const emptyPosition: Position = { quantity: "0", costBasis: "0" };

export function applyBuy(pos: Position, qty: string, cost: string | null): { position: Position } {
  const q = dec(qty);
  if (!q.isPositive()) throw new Error("Buy quantity must be positive");
  const newQty = dec(pos.quantity).plus(q);
  const basis = pos.costBasis === null || cost === null ? null : dec(pos.costBasis).plus(dec(cost)).toFixed();
  return { position: { quantity: newQty.toFixed(), costBasis: basis } };
}

export function averageCost(pos: Position): Dec | null {
  const q = dec(pos.quantity);
  if (pos.costBasis === null || q.isZero()) return null;
  return dec(pos.costBasis).div(q);
}

/** Disposal realises profit/loss against the average cost. */
export function applySell(pos: Position, qty: string, proceeds: string): { position: Position; realizedPnl: string | null } {
  const q = dec(qty);
  const held = dec(pos.quantity);
  if (!q.isPositive()) throw new Error("Sell quantity must be positive");
  if (q.gt(held)) throw new Error("Cannot sell more than the held quantity");

  const remaining = held.minus(q);
  if (pos.costBasis === null) {
    return { position: { quantity: remaining.toFixed(), costBasis: null }, realizedPnl: null };
  }
  const basis = dec(pos.costBasis);
  const soldCost = basis.times(q).div(held);
  const remainingBasis = remaining.isZero() ? new D(0) : basis.minus(soldCost);
  return {
    position: { quantity: remaining.toFixed(), costBasis: remainingBasis.toFixed() },
    realizedPnl: dec(proceeds).minus(soldCost).toFixed(),
  };
}

/** Transfer moves quantity AND proportional cost basis; no profit or loss is realised. */
export function applyTransfer(from: Position, to: Position, qty: string): { from: Position; to: Position } {
  const q = dec(qty);
  const held = dec(from.quantity);
  if (!q.isPositive()) throw new Error("Transfer quantity must be positive");
  if (q.gt(held)) throw new Error("Cannot transfer more than the held quantity");

  const moved = from.costBasis === null ? null : dec(from.costBasis).times(q).div(held);
  const remainingQty = held.minus(q);
  let fromBasis: string | null = null;
  if (from.costBasis !== null && moved !== null) {
    fromBasis = remainingQty.isZero() ? "0" : dec(from.costBasis).minus(moved).toFixed();
  }
  const toBasis = to.costBasis === null || moved === null ? null : dec(to.costBasis).plus(moved).toFixed();
  return {
    from: { quantity: remainingQty.toFixed(), costBasis: fromBasis },
    to: { quantity: dec(to.quantity).plus(q).toFixed(), costBasis: toBasis },
  };
}

/**
 * Unrealised P/L. `priceInFunctional` MUST already be quoted in the workspace functional
 * currency; callers select the quote by (asset, quoteCurrency) so a USD quote can never
 * be read as IDR. Unknown basis yields null, not zero.
 */
export function unrealizedPnl(pos: Position, priceInFunctional: string): { marketValue: string; pnl: string | null } {
  const value = dec(pos.quantity).times(dec(priceInFunctional));
  return {
    marketValue: value.toFixed(),
    pnl: pos.costBasis === null ? null : value.minus(dec(pos.costBasis)).toFixed(),
  };
}
