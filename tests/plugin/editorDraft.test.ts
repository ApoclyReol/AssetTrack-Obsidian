import { describe, expect, it } from "vitest";
import {
  DraftRecoveryStore,
  type DebtEditorDraftSnapshot
} from "../../src/ui/editorDraft";

describe("editor draft recovery store", () => {
  it("returns an isolated snapshot exactly once", () => {
    const store = new DraftRecoveryStore();
    const snapshot: DebtEditorDraftSnapshot = {
      kind: "debts",
      revision: 3,
      rows: [{ id: 7, description: "原草稿" }]
    };

    const token = store.store(snapshot);
    snapshot.rows[0].description = "外部修改";

    const restored = store.take(token);
    expect(restored).toEqual({
      kind: "debts",
      revision: 3,
      rows: [{ id: 7, description: "原草稿" }]
    });
    expect(store.take(token)).toBeUndefined();
  });

  it("clears pending recovery tokens", () => {
    const store = new DraftRecoveryStore();
    const token = store.store({
      kind: "debts",
      revision: 1,
      rows: []
    });

    store.clear();
    expect(store.take(token)).toBeUndefined();
  });
});
