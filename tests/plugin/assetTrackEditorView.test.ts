// @vitest-environment jsdom

import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type AssetTrackPlugin from "../../src/main";
import {
  DRAFT_RECOVERY_EPHEMERAL_KEY,
  type EditorDraftSnapshot
} from "../../src/ui/editorDraft";
import {
  AssetTrackEditorView,
  type AssetTrackViewState
} from "../../src/views/AssetTrackEditorView";

interface TestViewFields {
  dirty: boolean;
  draftSnapshot: EditorDraftSnapshot | null;
  state: AssetTrackViewState;
  root: { unmount: () => void } | null;
  confirmAction: () => Promise<boolean>;
  render: () => void;
}

function setup(discard: boolean) {
  const reopenEditorWithDraft = vi.fn().mockResolvedValue(undefined);
  const openEditor = vi.fn().mockResolvedValue(undefined);
  const plugin = {
    reopenEditorWithDraft,
    openEditor
  } as unknown as AssetTrackPlugin;
  const leaf = new WorkspaceLeaf();
  Object.assign(leaf, { app: {
    workspace: { requestSaveLayout: vi.fn() }
  } });
  const view = new AssetTrackEditorView(leaf, plugin);
  const snapshot: EditorDraftSnapshot = {
    kind: "transactions",
    month: "2026-08",
    workspace: {
      month: "2026-08",
      revision: 2,
      status: "saved",
      debt_revision: 3,
      cash_accounts: [],
      investment_accounts: [],
      transactions: [],
      debts: [{ id: 1, description: "未保存草稿", counterparty: "", amount: 1, start_date: "2026-08-01", is_paid: false, paid_date: null }],
      fixed_assets: [],
      computed: {},
      overview: { available: false }
    },
    categories: [],
    issues: []
  };
  const unmount = vi.fn();
  Object.assign(view as unknown as TestViewFields, {
    dirty: true,
    draftSnapshot: snapshot,
    state: { mode: "transactions", analysisMode: "annual", month: "2026-08" },
    root: { unmount },
    confirmAction: vi.fn().mockResolvedValue(discard)
  });
  return {
    view,
    snapshot,
    unmount,
    reopenEditorWithDraft,
    openEditor
  };
}

describe("AssetTrackEditorView close recovery", () => {
  it("reopens the same editor with its in-memory draft when close is canceled", async () => {
    const context = setup(false);

    await context.view.onClose();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(context.reopenEditorWithDraft).toHaveBeenCalledWith(
      { mode: "transactions", analysisMode: "annual", month: "2026-08" },
      context.snapshot
    );
    expect(context.openEditor).not.toHaveBeenCalled();
    expect(context.unmount).toHaveBeenCalledTimes(1);
  });

  it("discards the snapshot when close is confirmed", async () => {
    const context = setup(true);

    await context.view.onClose();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(context.reopenEditorWithDraft).not.toHaveBeenCalled();
    expect(context.openEditor).not.toHaveBeenCalled();
    expect(context.unmount).toHaveBeenCalledTimes(1);
  });

  it("consumes an ephemeral recovery token before rendering the reopened view", () => {
    const snapshot: EditorDraftSnapshot = {
      kind: "transactions",
      month: "2026-08",
      workspace: {
        month: "2026-08",
        revision: 2,
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
    };
    const takeDraftRecovery = vi.fn().mockReturnValue(snapshot);
    const plugin = { takeDraftRecovery } as unknown as AssetTrackPlugin;
    const leaf = new WorkspaceLeaf();
    Object.assign(leaf, {
      app: { workspace: { requestSaveLayout: vi.fn() } }
    });
    const view = new AssetTrackEditorView(leaf, plugin);
    const renderView = vi.fn();
    const unmount = vi.fn();
    Object.assign(view as unknown as TestViewFields, {
      root: { unmount },
      render: renderView
    });

    view.setEphemeralState({
      [DRAFT_RECOVERY_EPHEMERAL_KEY]: "token"
    });

    expect(takeDraftRecovery).toHaveBeenCalledWith("token");
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(renderView).toHaveBeenCalledTimes(1);
    expect(view.getState()).toMatchObject({
      mode: "transactions",
      month: "2026-08"
    });
    expect(view.hasUnsavedChanges()).toBe(true);
  });
});
