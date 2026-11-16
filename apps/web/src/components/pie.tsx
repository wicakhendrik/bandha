"use client";
import type { ReactNode } from "react";

/** Slice colours, in the Batik Sogan palette. Past the last one they repeat. */
export const PALETTE = ["#5C3A21", "#C58A2B", "#5B7A45", "#A8472D", "#8A6D56", "#2F6F6F", "#7A5A9C", "#B9A58C"];

export interface Slice {
  key: string;
  label: string;
  /** Used for the size of the slice only; display text comes from `valueText`. */
  value: number;
}

/**
 * Donut chart with a legend: a conic-gradient ring (no chart library) plus one legend row per slice with
 * its amount and share. Slices with no value are skipped.
 */
export function Pie({ slices, center, valueText, aria }: {
  slices: Slice[];
  center?: ReactNode;
  valueText?: (s: Slice) => string;
  aria: string;
}) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  const stops = shown.map((s, i) => {
    const from = acc;
    acc += (s.value / total) * 100;
    return `${PALETTE[i % PALETTE.length]} ${from}% ${Math.min(acc, 100)}%`;
  });

  return (
    <div className="pie-wrap">
      <div className="donut" role="img" aria-label={aria} style={{ background: `conic-gradient(${stops.join(",")})` }}>
        <div>{center}</div>
      </div>
      <div className="pie-legend">
        {shown.map((s, i) => (
          <div className="li" key={s.key}>
            <b style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="nm" title={s.label}>{s.label}</span>
            {valueText && <span className="num" style={{ fontSize: 13 }}>{valueText(s)}</span>}
            <span className="pc">{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
