import { afterEach, describe, expect, it } from "vitest";
import { debtKindLabel, debtTxTitle, setLang, txTypeLabel, txView, type Account, type Asset, type Tx } from "./index";

afterEach(() => setLang("id"));

const tx = (over: Partial<Tx>): Tx => ({
  id: "t1", type: "repay", status: "posted", occurredAt: "2026-11-16T05:00:00.000Z", description: null, category: null, tags: [], legs: [], ...over,
});
const acc: Account = { id: "a1", name: "BCA", kind: "bank", brandKey: null, includeInNetWorth: true, balances: [] };
const idr: Asset = { id: "idr", symbol: "IDR", name: "Rupiah", kind: "fiat", decimals: 0 };

describe("debt labels", () => {
  it("name the counterparty in both languages", () => {
    expect(debtTxTitle("borrow", "Budi")).toBe("Utang dari Budi");
    expect(debtTxTitle("collect", "Sari")).toBe("Terima dari Sari");
    setLang("en");
    expect(debtTxTitle("repay", "Budi")).toBe("Repaid Budi");
    expect(debtTxTitle("lend", "Sari")).toBe("Lent to Sari");
    expect(txTypeLabel("repay")).toBe("Repayment");
    expect(debtKindLabel("credit_card")).toBe("Credit card");
  });

  it("a debt transaction shows the counterparty and the cash leg; one without an account still renders", () => {
    const v = txView(
      tx({ debt: { id: "d1", counterparty: "Budi", direction: "payable" }, legs: [{ accountId: "a1", assetId: "idr", quantity: "-210000", functionalAmount: "-210000" }] }),
      new Map([["a1", acc]]), new Map([["idr", idr]]),
    );
    expect(v).toMatchObject({ title: "Bayar utang ke Budi", accountLabel: "BCA", amount: "−Rp 210.000", tone: "neg" });
    const none = txView(tx({ type: "borrow", debt: { id: "d1", counterparty: "Bank KPR", direction: "payable" } }), new Map(), new Map());
    expect(none).toMatchObject({ title: "Utang dari Bank KPR", amount: "—" });
  });
});
