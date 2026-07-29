import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  REQUIRED_COLUMNS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_INDEXES,
  REQUIRED_TABLES,
  createSchema
} from "./schema";
import { AssetTrackError } from "../services/AssetTrackService";
import { loadSqliteModule } from "../services/desktopRuntime";

type SqliteModule = typeof import("node:sqlite");

export interface SchemaValidation {
  valid: boolean;
  schema_version: number;
  tables: string[];
  missing_tables: string[];
  missing_columns: Record<string, string[]>;
  missing_indexes: string[];
  missing_foreign_keys: string[];
  integrity_check: string;
  foreign_key_violations: number | null;
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  validation: SchemaValidation | null;
  error: string | null;
}

function sqliteRuntime(): SqliteModule {
  try {
    const runtime = loadSqliteModule();
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

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master "
    + "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

function schemaValidation(db: DatabaseSync, full: boolean): SchemaValidation {
  const tables = tableNames(db);
  const missingTables = REQUIRED_TABLES.filter(
    (table) => !tables.includes(table)
  );
  const missingColumns = Object.fromEntries(
    REQUIRED_TABLES.flatMap((table) => {
      if (missingTables.includes(table)) return [];
      const columns = (
        db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
      ).map((row) => row.name);
      const missing = REQUIRED_COLUMNS[table].filter(
        (column) => !columns.includes(column)
      );
      return missing.length ? [[table, missing]] : [];
    })
  );
  const indexes = (
    db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL"
    ).all() as Array<{ name: string }>
  ).map((row) => row.name);
  const missingIndexes = REQUIRED_INDEXES.filter(
    (index) => !indexes.includes(index)
  );
  const missingForeignKeys = REQUIRED_FOREIGN_KEYS.flatMap((expected) => {
    if (missingTables.includes(expected.table)) {
      return [];
    }
    const foreignKeys = db.prepare(
      `PRAGMA foreign_key_list("${expected.table}")`
    ).all() as Array<{ table: string; from: string; to: string }>;
    const present = foreignKeys.some(
      (foreignKey) =>
        foreignKey.table === expected.targetTable
        && foreignKey.from === expected.from
        && foreignKey.to === expected.targetColumn
    );
    return present
      ? []
      : [
          `${expected.table}.${expected.from}`
          + `→${expected.targetTable}.${expected.targetColumn}`
        ];
  });
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version
  );
  const integrity = full
    ? String(
        (db.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }).integrity_check
      )
    : "skipped";
  const foreignKeyViolations = full
    ? db.prepare("PRAGMA foreign_key_check").all().length
    : null;
  const valid =
    version === CURRENT_SCHEMA_VERSION
    && missingTables.length === 0
    && Object.keys(missingColumns).length === 0
    && missingIndexes.length === 0
    && missingForeignKeys.length === 0
    && (integrity === "ok" || integrity === "skipped")
    && (foreignKeyViolations === 0 || foreignKeyViolations === null);
  return {
    valid,
    schema_version: version,
    tables,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    missing_indexes: missingIndexes,
    missing_foreign_keys: missingForeignKeys,
    integrity_check: integrity,
    foreign_key_violations: foreignKeyViolations
  };
}

function validationError(validation: SchemaValidation): string {
  const columns = Object.entries(validation.missing_columns)
    .map(([table, missing]) => `${table}(${missing.join(",")})`)
    .join(";");
  return `仅支持完整 schema ${CURRENT_SCHEMA_VERSION} 数据库；`
    + `版本=${validation.schema_version}，`
    + `缺少表=${validation.missing_tables.join(",") || "无"}，`
    + `缺少字段=${columns || "无"}，`
    + `缺少索引=${validation.missing_indexes.join(",") || "无"}，`
    + `缺少外键=${validation.missing_foreign_keys.join(",") || "无"}，`
    + `外键违规=${validation.foreign_key_violations ?? "未检查"}，`
    + `完整性=${validation.integrity_check}`;
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
      const validation = schemaValidation(db, true);
      return {
        exists: true,
        valid: validation.valid,
        validation,
        error: validation.valid ? null : validationError(validation)
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
        throw new Error(validationError(validation));
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
    return tableNames(db);
  }

  private validateDatabase(db: DatabaseSync, full: boolean): SchemaValidation {
    return schemaValidation(db, full);
  }
}
