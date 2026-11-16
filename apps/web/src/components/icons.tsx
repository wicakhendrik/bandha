const PATHS: Record<string, string> = {
  debt: "M12 3v18M7 8l5-5 5 5M5 21h14M6 15h12",
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16.5 14h.01",
  swap: "M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  up: "M7 17L17 7M9 7h8v8",
  plus: "M12 5v14M5 12h14",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z",
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
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z",
};

export function Icon({ name, size = 19, style }: { name: keyof typeof PATHS; size?: number; style?: React.CSSProperties }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g fill="none" stroke="#E2A93F" strokeWidth="2">
        <ellipse cx="20" cy="10" rx="6" ry="9.5" /><ellipse cx="20" cy="30" rx="6" ry="9.5" />
        <ellipse cx="10" cy="20" rx="9.5" ry="6" /><ellipse cx="30" cy="20" rx="9.5" ry="6" />
      </g>
      <circle cx="20" cy="20" r="3" fill="#E2A93F" />
    </svg>
  );
}
