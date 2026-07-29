import { describe, expect, it } from "vitest";
import {
  assertPathInsideVault,
  databaseVaultPath,
  backupsVaultPath,
  normalizeDataDirectory,
  validateDataDirectory
} from "../../src/services/workspacePath";

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
    expect(() => normalizeDataDirectory("../Asset_Track")).toThrow();
    expect(() => databaseVaultPath("")).toThrow("尚未选择");
  });

  it("rejects absolute, drive and UNC paths", () => {
    expect(() => normalizeDataDirectory("/tmp/Asset_Track")).toThrow("相对路径");
    expect(() => normalizeDataDirectory("C:\\Asset_Track")).toThrow("相对路径");
    expect(() => normalizeDataDirectory("\\\\server\\Asset_Track")).toThrow(
      "相对路径"
    );
    expect(validateDataDirectory("../Asset_Track")).toMatchObject({
      valid: false,
      normalized: ""
    });
  });

  it("rejects a resolved target outside the Vault", () => {
    expect(() => assertPathInsideVault("/vault", "/vault/data")).not.toThrow();
    expect(() => assertPathInsideVault("/vault", "/outside/data")).toThrow(
      "超出当前 Vault"
    );
  });
});
