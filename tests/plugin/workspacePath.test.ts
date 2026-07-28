import { describe, expect, it } from "vitest";
import {
  databaseVaultPath,
  backupsVaultPath,
  normalizeDataDirectory
} from "../../src/services/workspacePath";

describe("workspace path", () => {
  it("normalizes a Vault-relative Asset_Track root", () => {
    expect(normalizeDataDirectory(" /财务//Asset_Track/ ")).toBe(
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
    expect(() => normalizeDataDirectory("../Asset_Track")).toThrow();
    expect(() => databaseVaultPath("")).toThrow("尚未选择");
  });
});
