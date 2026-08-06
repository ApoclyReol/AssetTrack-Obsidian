import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";

const managers: DatabaseManager[] = [];

export function trackManager(manager: DatabaseManager): void {
  managers.push(manager);
}

export function fixture(): {
  manager: DatabaseManager;
  repository: AssetTrackRepository;
  path: string;
} {
  const root = mkdtempSync(join(tmpdir(), "asset-track-ts-"));
  const path = join(root, "中文 账本", "accounting_system.db");
  const manager = new DatabaseManager(path);
  trackManager(manager);
  const repository = new AssetTrackRepository(manager);
  repository.initialize();
  return { manager, repository, path };
}

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.close());
});
