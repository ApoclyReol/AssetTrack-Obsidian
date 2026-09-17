// @vitest-environment jsdom

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type AssetTrackPlugin from "../../src/main";
import AssetTrackPluginClass from "../../src/main";
import {
  DRAFT_RECOVERY_EPHEMERAL_KEY,
  type EditorDraftSnapshot
} from "../../src/ui/editorDraft";
import {
  AssetTrackEditorView,
  type AssetTrackViewState
} from "../../src/views/AssetTrackEditorView";

vi.mock("../../src/services/desktopRuntime", () => ({
  loadElectronModule: () => ({
    shell: { showItemInFolder: () => undefined }
  })
}));

interface TestViewFields {
  sessionSnapshot: EditorDraftSnapshot | null;
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
      computed: null,
      overview: { available: false }
    },
    categories: [],
    issues: []
  };
  const unmount = vi.fn();
  Object.assign(view as unknown as TestViewFields, {
    sessionSnapshot: snapshot,
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
        computed: null,
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

describe("AssetTrackPlugin view-open database initialization", () => {
  it("deduplicates concurrent automatic database loads from view open", async () => {
    const resolveLoad: Array<() => void> = [];
    const loadDatabase = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad.push(resolve);
    }));
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings: { dataDirectory: "Asset-track", csvMappings: [] },
      databaseState: "unconfigured",
      databaseError: null,
      databaseManager: null,
      loadDatabase,
      refreshViews: vi.fn().mockResolvedValue(undefined)
    });

    const first = plugin.prepareDatabaseOnViewOpen();
    const second = plugin.prepareDatabaseOnViewOpen();

    expect(loadDatabase).toHaveBeenCalledTimes(1);
    expect(loadDatabase).toHaveBeenCalledWith("Asset-track");
    expect(resolveLoad).toHaveLength(1);
    resolveLoad[0]();
    await Promise.all([first, second]);
  });

  it("persists the complete settings snapshot when the data directory changes", async () => {
    const saveData = vi.fn().mockResolvedValue(undefined);
    const settings = {
      dataDirectory: "旧目录",
      csvMappings: [{
        header_signature: "sig",
        updated_at: "2026-09-16T00:00:00.000Z",
        mapping: {
          date_column: "日期",
          product_column: "商品",
          amount_column: "金额",
          type_column: "收支",
          type_values: { 支出: "支出" },
          included_statuses: ["成功"]
        }
      }],
      baseCurrency: "USD",
      currencyFormat: "accounting" as const,
      reconciliationTolerance: 12,
      largeExpenseThreshold: 3456,
      aiEndpoint: "https://example.test/classify",
      aiModel: "model-x",
      aiTimeoutMs: 12000
    };
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings,
      settingsIssues: ["old issue"],
      saveData
    });

    await (plugin as unknown as {
      persistDataDirectorySettings: (value: string) => Promise<void>;
    }).persistDataDirectorySettings("新目录");

    expect(settings.dataDirectory).toBe("新目录");
    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({
      dataDirectory: "新目录",
      baseCurrency: "USD",
      currencyFormat: "accounting",
      reconciliationTolerance: 12,
      largeExpenseThreshold: 3456,
      aiEndpoint: "https://example.test/classify",
      aiModel: "model-x",
      aiTimeoutMs: 12000
    }));
    expect(saveData.mock.calls[0][0]).not.toBe(settings);
  });

  it("restores the previous data directory when settings persistence fails", async () => {
    const saveData = vi.fn().mockRejectedValue(new Error("disk full"));
    const settings = {
      dataDirectory: "旧目录",
      csvMappings: [],
      baseCurrency: "CNY",
      currencyFormat: "standard" as const,
      reconciliationTolerance: 100,
      largeExpenseThreshold: 1000,
      aiEndpoint: "",
      aiModel: "",
      aiTimeoutMs: 60000
    };
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings,
      settingsIssues: [],
      saveData
    });

    await expect((plugin as unknown as {
      persistDataDirectorySettings: (value: string) => Promise<void>;
    }).persistDataDirectorySettings("新目录")).rejects.toThrow("disk full");

    expect(settings.dataDirectory).toBe("旧目录");
  });

  it("rolls back ordinary settings and mapping removal when persistence fails", async () => {
    const saveData = vi.fn().mockRejectedValue(new Error("disk full"));
    const settings = {
      dataDirectory: "Asset-track",
      csvMappings: [{
        header_signature: "sig",
        updated_at: "2026-09-16T00:00:00.000Z",
        mapping: {
          date_column: "日期",
          product_column: "商品",
          amount_column: "金额",
          type_column: "收支",
          type_values: { 支出: "支出" },
          included_statuses: ["成功"]
        }
      }],
      baseCurrency: "CNY",
      currencyFormat: "standard" as const,
      reconciliationTolerance: 100,
      largeExpenseThreshold: 1000,
      aiEndpoint: "",
      aiModel: "",
      aiTimeoutMs: 60000
    };
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings,
      settingsIssues: [],
      saveData,
      settingsWriteTail: Promise.resolve()
    });

    await expect(plugin.updateSettings((next) => {
      next.baseCurrency = "USD";
    })).rejects.toThrow("disk full");
    expect(settings.baseCurrency).toBe("CNY");

    await expect(plugin.clearCsvMapping("sig")).rejects.toThrow("disk full");
    expect(settings.csvMappings).toHaveLength(1);
  });

  it("serializes complete settings snapshots without losing concurrent changes", async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    let releaseFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSaveStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstSaveStarted = resolve;
    });
    const saveData = vi.fn(async (data: Record<string, unknown>) => {
      snapshots.push(data);
      if (snapshots.length === 1) {
        firstSaveStarted();
        await firstSave;
      }
    });
    const settings = {
      dataDirectory: "Asset-track",
      csvMappings: [],
      baseCurrency: "CNY",
      currencyFormat: "standard" as const,
      reconciliationTolerance: 100,
      largeExpenseThreshold: 1000,
      aiEndpoint: "",
      aiModel: "",
      aiTimeoutMs: 60000
    };
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings,
      settingsIssues: [],
      saveData,
      settingsWriteTail: Promise.resolve()
    });

    const first = plugin.updateSettings((next) => {
      next.baseCurrency = "USD";
    });
    await firstStarted;
    const second = plugin.updateSettings((next) => {
      next.aiModel = "model-x";
    });

    expect(saveData).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ baseCurrency: "USD", aiModel: "" });
    expect(snapshots[1]).toMatchObject({ baseCurrency: "USD", aiModel: "model-x" });
    expect(settings).toMatchObject({ baseCurrency: "USD", aiModel: "model-x" });
  });

  it("updates the runtime analysis settings and invalidates view subscribers", () => {
    const updateRuntimeSettings = vi.fn();
    const listener = vi.fn();
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings: {
        dataDirectory: "Asset-track",
        csvMappings: [],
        baseCurrency: "CNY",
        currencyFormat: "standard",
        reconciliationTolerance: 10,
        largeExpenseThreshold: 50
      },
      databaseState: "ready",
      databaseManager: {},
      api: { updateRuntimeSettings },
      dataListeners: new Set([listener])
    });

    plugin.updateRuntimeSettings();

    expect(updateRuntimeSettings).toHaveBeenCalledWith({
      reconciliationTolerance: 10,
      largeExpenseThreshold: 50
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes a failed migration incoming artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-migration-"));
    const target = join(root, "new", "accounting_system.db");
    const currentManager = {
      snapshot: vi.fn(async (path: string) => {
        writeFileSync(path, "not a sqlite database", "utf8");
      })
    };
    const plugin = Object.create(AssetTrackPluginClass.prototype) as AssetTrackPlugin;
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settings: {
        dataDirectory: "old",
        csvMappings: [],
        baseCurrency: "CNY",
        currencyFormat: "standard",
        reconciliationTolerance: 100,
        largeExpenseThreshold: 1000
      },
      databaseState: "ready",
      databaseManager: currentManager,
      api: { close: vi.fn() },
      hasUnsavedEditorChanges: () => false,
      inspectDataDirectory: vi.fn().mockResolvedValue({
        exists: false,
        valid: false,
        validation: null,
        error: null
      }),
      createProtectionBackup: vi.fn().mockResolvedValue("/tmp/protection.db"),
      fullDatabasePath: vi.fn().mockReturnValue(target)
    });

    await expect(plugin.switchDataDirectory("new", "migrate"))
      .rejects.toMatchObject({ code: "database.migration_validation_failed" });
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.incoming`)).toBe(false);
  });
});
