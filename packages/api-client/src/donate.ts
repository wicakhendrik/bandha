import qrcode from "qrcode-generator";

/** Where donations for Bandha's running costs (server, domain, email) can be sent. Shared by web and mobile. */
export const QRIS = { merchant: "GRES STORE", nmid: "ID1022172005988" } as const;

export type CryptoWalletKind = "evm" | "solana" | "sui";

export interface CryptoWallet {
  kind: CryptoWalletKind;
  /** Short name shown as the card title. */
  name: string;
  address: string;
  /** Networks and tokens this address receives. */
  networks: string[];
}

export const DONATE_WALLETS: readonly CryptoWallet[] = [
  { kind: "evm", name: "Ethereum & EVM", address: "0x44D3590011b625b3b1e8C3c3F9326A83F154a4f5", networks: ["Ethereum (L1)", "Base", "Arbitrum", "BNB Smart Chain", "Optimism", "Polygon"] },
  { kind: "solana", name: "Solana", address: "6ffRXbnsNeC712YPfaUHaQdTSkjVyb2cG4PX6bmnVvge", networks: ["Solana (SOL)", "SPL tokens"] },
  { kind: "sui", name: "Sui", address: "0x16842568bcf2efe9ac5d4a92454739b1605ccf9bc1f4962f3b506da103e98860", networks: ["Sui (SUI)"] },
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True when `address` has the right shape for the chain family. A typo in a hard-coded address would be unrecoverable, so a test checks the constants above. */
export function isValidWalletAddress(kind: CryptoWalletKind, address: string): boolean {
  if (kind === "evm") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (kind === "sui") return /^0x[0-9a-fA-F]{64}$/.test(address);
  return BASE58.test(address);
}

/** A QR code as rows of dark/light modules, so every UI can draw it its own way (SVG on web, react-native-svg on mobile). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path (in module units) that draws every dark module; pair it with a viewBox of `0 0 n n`. */
export function qrPath(matrix: boolean[][]): string {
  let d = "";
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let end = c;
      while (end < row.length && row[end]) end++;
      d += `M${c} ${r}h${end - c}v1h${-(end - c)}z`;
      c = end;
    }
  });
  return d;
}
