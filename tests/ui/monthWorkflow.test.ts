import { describe, expect, it } from "vitest";
import type { MonthWorkspace } from "../../src/types/month";
import { monthWorkflowSummary } from "../../src/ui/monthWorkflow";

const transaction = {
  transaction_date: "2026-01-01",
  type: "支出",
  category: "餐饮",
  product: "早餐",
  amount: 12
};

type Reconciliation = NonNullable<MonthWorkspace["overview"]["reconciliation"]>;
type ReconciliationPatch = Partial<Omit<Reconciliation, "theoretical">> & {
  theoretical?: Partial<Reconciliation["theoretical"]>;
};

function workspace(
  overrides: Partial<Pick<MonthWorkspace, "transactions" | "status">> & {
    reconciliation?: ReconciliationPatch;
  } = {}
): MonthWorkspace {
  const baseReconciliation: Reconciliation = {
    available: true,
    actual: { all_out: 12, daifu: 0, net_expense: 12 },
    theoretical: {
      previous_cash: 100,
      income: 0,
      debt_change: 0,
      cash: 88,
      deposit: 0,
      withdraw: 0,
      net_expense: 12
    },
    discrepancy: 0,
    explanation: {
      level: "success",
      title: "已平账",
      summary: "无差额",
      causes: [],
      suggestions: []
    }
  };
  const reconciliation: Reconciliation = {
    ...baseReconciliation,
    ...overrides.reconciliation,
    theoretical: {
      ...baseReconciliation.theoretical,
      ...overrides.reconciliation?.theoretical
    }
  };
  return {
    month: "2026-01",
    revision: 1,
    status: overrides.status ?? "saved",
    debt_revision: 1,
    cash_accounts: [],
    investment_accounts: [],
    transactions: overrides.transactions ?? [],
    debts: [],
    fixed_assets: [],
    computed: null,
    overview: {
      available: true,
      reconciliation
    }
  };
}

describe("month workflow summary", () => {
  it("starts with the import action when the month has no transactions", () => {
    expect(monthWorkflowSummary(workspace()).status).toBe("not-started");
    expect(monthWorkflowSummary(workspace()).nextAction).toBe("导入账单");
  });

  it("prioritizes transaction issues before asset or reconciliation work", () => {
    const result = monthWorkflowSummary(
      workspace({ transactions: [transaction] }),
      [{ field: "分类", blocking: true }]
    );
    expect(result.status).toBe("to-organize");
    expect(result.blockingIssueCount).toBe(1);
  });

  it("asks for asset details before reconciliation when prior cash is unavailable", () => {
    const result = monthWorkflowSummary(
      workspace({
        transactions: [transaction],
        reconciliation: { theoretical: { previous_cash: null } }
      })
    );
    expect(result.status).toBe("to-supplement-assets");
    expect(result.nextSection).toBe("assets");
  });

  it("distinguishes an unresolved difference from a completed month", () => {
    expect(monthWorkflowSummary(
      workspace({ transactions: [transaction], reconciliation: { discrepancy: 250 } })
    ).status).toBe("to-reconcile");
    expect(monthWorkflowSummary(workspace({ transactions: [transaction] })).status).toBe("completed");
  });
});
