import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  REQUIRED_TABLES,
  createSchema
} from "./schema";
import { AssetTrackError } from "../services/AssetTrackService";

type SqliteModule = typeof import("node:sqlite");

export interface SchemaValidation {
  valid: boolean;
  schema_version: number;
  tables: string[];
  missing_tables: string[];
  integrity_check: string;
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  validation: SchemaValidation | null;
  error: string | null;
}

function sqliteRuntime(): SqliteModule {
  try {
    const runtime = require("node:sqlite") as SqliteModule;
    if (!runtime.DatabaseSync || !runtime.backup) throw new Error("API 不完整");
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 16)) {
      throw new Error(`Node ${process.versions.node} 低于 22.16`);
    }
    return runtime;
  } catch (error) {
    throw new AssetTrackError(
      `当前 Obsidian 桌面运行时不支持 node:sqlite（${String(error)}）。`
      + "请下载并安装新版 Obsidian 桌面安装器后重试。",
      503,
      { node: process.versions.node, electron: process.versions.electron },
      "sqlite_runtime_unavailable"
    );
  }
}

export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();
  private restoring = false;

  constructor(private path: string) {}

  static inspect(path: string): DatabaseInspection {
    if (!existsSync(path)) {
      return { exists: false, valid: false, validation: null, error: null };
    }
    let db: DatabaseSync | null = null;
    try {
      const runtime = sqliteRuntime();
      db = new runtime.DatabaseSync(path, { readOnly: true, timeout: 5000 });
      const tables = (db.prepare(
        "SELECT name FROM sqlite_master "
        + "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>).map((row) => row.name);
      const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
      const version = Number(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
      );
      const integrity = String(
        (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check
      );
      const validation = {
        valid:
          version === CURRENT_SCHEMA_VERSION
          && missing.length === 0
          && integrity === "ok",
        schema_version: version,
        tables,
        missing_tables: missing,
        integrity_check: integrity
      };
      return {
        exists: true,
        valid: validation.valid,
        validation,
        error: validation.valid
          ? null
          : `仅支持完整 schema ${CURRENT_SCHEMA_VERSION} 数据库；`
            + `版本=${version}，缺少表=${missing.join(",") || "无"}，`
            + `完整性=${integrity}`
      };
    } catch (error) {
      return {
        exists: true,
        valid: false,
        validation: null,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      db?.close();
    }
  }

  setPath(path: string): void {
    if (path === this.path) return;
    this.close();
    this.path = path;
  }

  getPath(): string {
    return this.path;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  open(): DatabaseSync {
    if (this.db) return this.db;
    const runtime = sqliteRuntime();
    mkdirSync(dirname(this.path), { recursive: true });
    const db = new runtime.DatabaseSync(this.path, {
      open: true,
      readOnly: false,
      timeout: 5000
    });
    try {
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=5000");
      db.exec("PRAGMA journal_mode=WAL");
      const tables = this.tableNames(db);
      if (!tables.length) {
        db.exec("BEGIN IMMEDIATE");
        try {
          createSchema(db);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      const validation = this.validateDatabase(db, false);
      if (!validation.valid) {
        throw new Error(
          `仅支持完整 schema ${CURRENT_SCHEMA_VERSION} 数据库；`
          + `版本=${validation.schema_version}，`
          + `缺少表=${validation.missing_tables.join(",")}`
        );
      }
      const accountCount = Number(
        (db.prepare("SELECT COUNT(*) AS count FROM account_definitions").get() as { count: number }).count
      );
      if (accountCount === 0) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "INSERT INTO account_definitions "
            + "(account_key,name,account_type,is_active,sort_order) VALUES (?,?,?,?,?)"
          ).run("cash-default", "默认现金账户", "cash", 1, 0);
          db.prepare(
            "INSERT INTO account_definitions "
            + "(account_key,name,account_type,is_active,sort_order) VALUES (?,?,?,?,?)"
          ).run("investment-default", "默认理财账户", "investment", 1, 1);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      this.db = db;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  connection(): DatabaseSync {
    if (this.restoring) throw new AssetTrackError("数据库正在恢复，请稍后重试", 423);
    return this.open();
  }

  async write<T>(operation: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const db = this.connection();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await operation(db);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The original failure remains authoritative.
        }
        throw error;
      }
    };
    const next = this.writeTail.then(run, run);
    this.writeTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async drain(): Promise<void> {
    await this.writeTail;
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  async reopen(): Promise<void> {
    await this.drain();
    this.close();
    this.open();
  }

  async withRestoreLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.drain();
    this.restoring = true;
    this.close();
    try {
      return await operation();
    } finally {
      this.restoring = false;
    }
  }

  async snapshot(targetPath: string): Promise<void> {
    await this.drain();
    mkdirSync(dirname(targetPath), { recursive: true });
    await sqliteRuntime().backup(this.connection(), targetPath);
  }

  validate(full = true): SchemaValidation {
    return this.validateDatabase(this.connection(), full);
  }

  private tableNames(db: DatabaseSync): string[] {
    return (db.prepare(
      "SELECT name FROM sqlite_master "
      + "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>).map((row) => row.name);
  }

  private validateDatabase(db: DatabaseSync, full: boolean): SchemaValidation {
    const tables = this.tableNames(db);
    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    const version = Number(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    );
    const integrity = full
      ? String(
        (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check
      )
      : "skipped";
    return {
      valid:
        version === CURRENT_SCHEMA_VERSION
        && missing.length === 0
        && (integrity === "ok" || integrity === "skipped"),
      schema_version: version,
      tables,
      missing_tables: missing,
      integrity_check: integrity
    };
  }
}
