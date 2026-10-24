// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssetTrackPlugin from "../../src/main";
import { DatabaseUpgradeContent, DatabaseUpgradeModal } from "../../src/ui/DatabaseUpgradeModal";
import { setTestLanguage } from "../mocks/obsidian";

vi.mock("../../src/services/desktopRuntime", () => ({
  loadElectronModule: () => ({ shell: { showItemInFolder: () => undefined } })
}));

const impact = { from_schema: 12, category_count: 18, transaction_count: 120,
  legacy_necessity_count: 0, legacy_pattern_count: 0, legacy_big_ticket_count: 0 };

afterEach(() => { cleanup(); vi.restoreAllMocks(); setTestLanguage("zh-CN"); });

function setup() {
  const choices: Array<(choice: boolean) => void> = [];
  const open = vi.spyOn(DatabaseUpgradeModal.prototype, "open").mockImplementation(function (this: DatabaseUpgradeModal) {
    choices.push((this as unknown as { options: { onChoice: (choice: boolean) => void } }).options.onChoice);
  });
  const close = vi.spyOn(DatabaseUpgradeModal.prototype, "close").mockImplementation(() => undefined);
  const inspect = vi.fn().mockResolvedValue({ exists: true, valid: false, migration_required: true, migration_impact: impact });
  const load = vi.fn().mockResolvedValue(undefined);
  const plugin = Object.create(AssetTrackPlugin.prototype) as AssetTrackPlugin;
  Object.assign(plugin, { app: {}, settings: { dataDirectory: "财务/Asset-track", csvMappings: [] },
    databaseState: "unconfigured", databaseError: null, databaseManager: null,
    inspectDataDirectory: inspect, loadDatabase: load, refreshViews: vi.fn().mockResolvedValue(undefined),
    draftRecoveries: { clear: vi.fn() } });
  return { plugin, choices, open, close, inspect, load };
}

describe("automatic ledger upgrade", () => {
  it("shows the directory and impact and requires an explicit choice", () => {
    const choose = vi.fn();
    render(<DatabaseUpgradeContent directory="财务/Asset-track" impact={impact} onChoice={choose} />);
    expect(screen.getByText("数据目录：财务/Asset-track")).toBeTruthy();
    expect(screen.getByText("18 个分类 · 120 笔流水")).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "稍后" })); expect(choose).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "备份并升级" })); expect(choose).toHaveBeenLastCalledWith(true);
  });

  it("provides the same confirmation in English", () => {
    setTestLanguage("en");
    render(<DatabaseUpgradeContent directory="Finance" impact={impact} onChoice={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back up and upgrade" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    expect(screen.getByText(/protection backup before upgrading/)).toBeTruthy();
  });

  it("deduplicates prompts across views and does not load before confirmation", async () => {
    const { plugin, choices, open, inspect, load } = setup();
    const first = plugin.prepareDatabaseOnViewOpen(); const second = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(inspect).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
    expect(plugin.databaseState).toBe("migration-required");
    choices[0](true); await Promise.all([first, second]);
    expect(load).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledWith("财务/Asset-track", "preserve");
  });

  it("loads an already current ledger without prompting for another upgrade", async () => {
    const { plugin, open, inspect, load } = setup();
    inspect.mockResolvedValueOnce({ exists: true, valid: true, migration_required: false });
    await plugin.prepareDatabaseOnViewOpen();
    expect(open).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledWith("财务/Asset-track");
  });

  it("leaves the ledger unopened after cancellation and allows retry", async () => {
    const { plugin, choices, open, load } = setup();
    const first = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    choices[0](false); await first;
    expect(load).not.toHaveBeenCalled(); expect(plugin.databaseState).toBe("migration-required");
    const retry = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    choices[1](true); await retry;
    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores confirmation if the selected data directory changed", async () => {
    const { plugin, choices, open, load } = setup();
    const pending = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    plugin.settings.dataDirectory = "另一个账本";
    choices[0](true); await pending;
    expect(load).not.toHaveBeenCalled();
  });

  it("closes the prompt on unload and ignores a late confirmation", async () => {
    const { plugin, choices, open, close, load } = setup();
    const pending = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    act(() => plugin.onunload()); expect(close).toHaveBeenCalledOnce();
    choices[0](true); await pending;
    expect(load).not.toHaveBeenCalled();
  });

  it("does not open a writable service if unloading while rechecking a confirmed upgrade", async () => {
    const { plugin, inspect } = setup();
    let finishInspection!: (value: { exists: boolean; migration_required: boolean }) => void;
    inspect.mockImplementationOnce(() => new Promise((resolve) => { finishInspection = resolve; }));
    const buildService = vi.fn();
    Object.assign(plugin, { buildService });
    const pending = (plugin as unknown as { activateInitialDatabase: (directory: string, create: boolean) => Promise<void> })
      .activateInitialDatabase("财务/Asset-track", false);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    plugin.onunload();
    finishInspection({ exists: true, migration_required: true }); await pending;
    expect(buildService).not.toHaveBeenCalled(); expect(plugin.isDatabaseReady()).toBe(false);
  });

  it("reports a failed upgrade without marking the ledger ready", async () => {
    const { plugin, choices, open, load } = setup();
    const error = new Error("Upgrade failed"); load.mockRejectedValueOnce(error);
    const pending = plugin.prepareDatabaseOnViewOpen();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    choices[0](true); await pending;
    expect(plugin.databaseState).toBe("error"); expect(plugin.databaseError).toBe(error);
    expect(plugin.isDatabaseReady()).toBe(false);
  });
});
