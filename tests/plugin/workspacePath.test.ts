import { describe, expect, it } from "vitest";
import {
  assertPathInsideVault,
  databaseVaultPath,
  backupsVaultPath,
  normalizeDataDirectory,
  validateDataDirectory
} from "../../src/services/workspacePath";
import { AssetTrackError } from "../../src/application/errors";

function thrownCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetTrackError);
    return (error as AssetTrackError).code;
  }
  throw new Error("Expected action to throw");
}

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
