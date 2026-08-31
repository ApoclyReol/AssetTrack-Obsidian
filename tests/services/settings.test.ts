import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parseAssetTrackSettings } from "../../src/services/settingsValidation";
import type { AssetTrackService } from "../../src/services/AssetTrackService";
import type {
  AnalysisPort,
  BackupPort,
  ConfigurationEditorPort,
  EditorShellPort,
  MonthEditorPort,
  RuntimePort
} from "../../src/services/ports";
import {
  assertPathInsideVault,
  backupsVaultPath,
  databaseVaultPath,
  normalizeDataDirectory,
  validateDataDirectory
} from "../../src/services/workspacePath";
import { AssetTrackError } from "../../src/application/errors";

const root = resolve(import.meta.dirname, "../..");

function thrownCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetTrackError);
    return (error as AssetTrackError).code;
  }
  throw new Error("Expected action to throw");
}

describe("settings validation", () => {
  it("normalizes valid settings and mapping profiles", () => {
    const result = parseAssetTrackSettings({
      dataDirectory: " 财务//Asset_Track/ ",
      csvMappings: [{
        header_signature: "abc",
        updated_at: "2026-07-29T00:00:00.000Z",
        mapping: {
          date_column: "日期",
          product_column: "商品",
          amount_column: "金额",
          type_column: "类型",
          type_values: { 支出: "支出" },
          included_statuses: []
        }
      }]
    });
    expect(result.issues).toEqual([]);
    expect(result.settings.dataDirectory).toBe("财务/Asset_Track");
    expect(result.settings.csvMappings).toHaveLength(1);
  });

  it("falls back safely for malformed settings", () => {
    const result = parseAssetTrackSettings({
      dataDirectory: "/outside",
      csvMappings: [{ header_signature: "broken" }, null]
    });
    expect(result.settings).toEqual({
      dataDirectory: "",
      csvMappings: [],
      baseCurrency: "CNY",
      currencyFormat: "standard",
      reconciliationTolerance: 100,
      largeExpenseThreshold: 1000,
      aiEndpoint: "",
      aiModel: "",
      aiTimeoutMs: 60000
    });
    expect(result.issues).toHaveLength(3);
  });
});

describe("Obsidian 1.13 settings boundary", () => {
  it("uses declarative settings without a PluginSettingTab display override", () => {
    const source = readFileSync(resolve(root, "src/settings.ts"), "utf8").replace(
      /\r\n/g,
      "\n"
    );

    expect(source).toContain("getSettingDefinitions(): SettingDefinitionItem[]");
    expect(source).toContain('control: {\n              type: "folder"');
    const tabSource = source.slice(
      source.indexOf("export class AssetTrackSettingTab"),
      source.indexOf("class AssetTrackBackupPage")
    );
    expect(tabSource).not.toContain("display(): void");
  });

  it("does not enumerate the full vault from plugin settings", () => {
    const source = readFileSync(resolve(root, "src/settings.ts"), "utf8");

    expect(source).not.toMatch(/\b(?:getAllLoadedFiles|getFiles|getMarkdownFiles)\s*\(/);
  });

  it("publishes the Obsidian 1.13 minimum version", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "manifest.json"), "utf8")
    ) as { version: string; minAppVersion: string };
    const versions = JSON.parse(
      readFileSync(resolve(root, "versions.json"), "utf8")
    ) as Record<string, string>;

    expect(manifest.version).toBe("1.8.1");
    expect(manifest.minAppVersion).toBe("1.13.0");
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });
});

describe("service capability ports", () => {
  it("keeps the aggregate local service assignable to every UI capability", () => {
    expectTypeOf<AssetTrackService>().toExtend<MonthEditorPort>();
    expectTypeOf<AssetTrackService>().toExtend<ConfigurationEditorPort>();
    expectTypeOf<AssetTrackService>().toExtend<EditorShellPort>();
    expectTypeOf<AssetTrackService>().toExtend<AnalysisPort>();
    expectTypeOf<AssetTrackService>().toExtend<BackupPort>();
    expectTypeOf<AssetTrackService>().toExtend<RuntimePort>();
  });
});

describe("workspace path", () => {
  it("normalizes a Vault-relative Asset_Track root", () => {
    expect(normalizeDataDirectory(" 财务//Asset_Track/ ")).toBe(
      "财务/Asset_Track"
    );
    expect(databaseVaultPath("财务/Asset_Track")).toBe(
      "财务/Asset_Track/accounting_system.db"
    );
    expect(backupsVaultPath("财务/Asset_Track")).toBe(
      "财务/Asset_Track/backups"
    );
  });

  it("rejects traversal and unconfigured roots", () => {
    expect(thrownCode(() => normalizeDataDirectory("../Asset_Track"))).toBe(
      "workspace.dot_segment"
    );
    expect(thrownCode(() => databaseVaultPath(""))).toBe(
      "workspace.data_directory_required"
    );
  });

  it("rejects absolute, drive and UNC paths", () => {
    expect(thrownCode(() => normalizeDataDirectory("/tmp/Asset_Track"))).toBe(
      "workspace.relative_required"
    );
    expect(thrownCode(() => normalizeDataDirectory("C:\\Asset_Track"))).toBe(
      "workspace.relative_required"
    );
    expect(thrownCode(() => normalizeDataDirectory("\\\\server\\Asset_Track"))).toBe(
      "workspace.relative_required"
    );
    expect(validateDataDirectory("../Asset_Track")).toMatchObject({
      valid: false,
      normalized: ""
    });
  });

  it("rejects a resolved target outside the Vault", () => {
    expect(() => assertPathInsideVault("/vault", "/vault/data")).not.toThrow();
    expect(thrownCode(() => assertPathInsideVault("/vault", "/outside/data"))).toBe(
      "workspace.outside_vault"
    );
  });
});
