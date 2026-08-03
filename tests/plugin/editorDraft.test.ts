import { describe, expect, it } from "vitest";
import {
  DraftRecoveryStore,
  type MonthEditorDraftSnapshot
} from "../../src/ui/editorDraft";

describe("editor draft recovery store", () => {
  it("returns an isolated snapshot exactly once", () => {
    const store = new DraftRecoveryStore();
    const snapshot: MonthEditorDraftSnapshot = {
      kind: "transactions",
      month: "2026-08",
      workspace: {
        month: "2026-08",
        revision: 3,
        status: "saved",
        debt_revision: 4,
        cash_accounts: [],
        investment_accounts: [],
        transactions: [],
        debts: [{ id: 7, description: "原草稿", counterparty: "", amount: 1, start_date: "2026-08-01", is_paid: false, paid_date: null }],
        fixed_assets: [],
        computed: {},
        overview: { available: false }
      },
      categories: [],
      issues: []
    };

    const token = store.store(snapshot);
    snapshot.workspace.debts[0].description = "外部修改";

    const restored = store.take(token);
    expect(restored).toEqual({
      kind: "transactions",
      month: "2026-08",
      workspace: {
        month: "2026-08",
        revision: 3,
        status: "saved",
        debt_revision: 4,
        cash_accounts: [],
        investment_accounts: [],
        transactions: [],
        debts: [{ id: 7, description: "原草稿", counterparty: "", amount: 1, start_date: "2026-08-01", is_paid: false, paid_date: null }],
        fixed_assets: [],
        computed: {},
        overview: { available: false }
      },
      categories: [],
      issues: []
    });
    expect(store.take(token)).toBeUndefined();
  });

  it("clears pending recovery tokens", () => {
    const store = new DraftRecoveryStore();
    const token = store.store({
      kind: "transactions",
      month: "2026-08",
      workspace: {
        month: "2026-08",
        revision: 1,
        status: "saved",
        debt_revision: 1,
        cash_accounts: [],
        investment_accounts: [],
        transactions: [],
        debts: [],
        fixed_assets: [],
        computed: {},
        overview: { available: false }
      },
      categories: [],
      issues: []
    });

    store.clear();
    expect(store.take(token)).toBeUndefined();
  });
});
