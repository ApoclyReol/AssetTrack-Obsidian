import { describe, expect, it } from "vitest";
import {
  databaseVaultPath,
  normalizeWorkspacePath
} from "../../src/services/workspacePath";

describe("workspace path", () => {
  it("normalizes a Vault-relative Asset_Track root", () => {
    expect(normalizeWorkspacePath(" /财务//Asset_Track/ ")).toBe(
      "财务/Asset_Track"
    );
    expect(databaseVaultPath("财务/Asset_Track")).toBe(
      "财务/Asset_Track/data/accounting_system.db"
    );
  });

  it("rejects traversal and unconfigured roots", () => {
    expect(() => normalizeWorkspacePath("../Asset_Track")).toThrow();
    expect(() => databaseVaultPath("")).toThrow("尚未选择");
  });
});
