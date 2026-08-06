import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  PREVIOUS_SCHEMA_VERSION,
  REQUIRED_COLUMNS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_GENERATED_COLUMNS,
  REQUIRED_INDEX_DEFINITIONS,
  REQUIRED_INDEXES,
  REQUIRED_TABLES,
  canMigrateSchema9,
  createSchema,
  migrateSchema9To10,
  registerSchemaFunctions,
  SchemaMigrationError,
  type SchemaMigrationReport
} from "./schema";
import { AssetTrackError } from "../application/errors";
import { loadSqliteModule } from "../services/desktopRuntime";

type SqliteModule = typeof import("node:sqlite");

export interface SchemaValidation {
  valid: boolean;
  schema_version: number;
  tables: string[];
  missing_tables: string[];
  missing_columns: Record<string, string[]>;
  invalid_columns: Record<string, string[]>;
  missing_indexes: string[];
  invalid_indexes: string[];
  missing_foreign_keys: string[];
  integrity_check: string;
  foreign_key_violations: number | null;
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  migration_required?: boolean;
  validation: SchemaValidation | null;
  error: string | AssetTrackError | null;
}

function sqliteRuntime(): SqliteModule {
  try {
    const runtime = loadSqliteModule();
    if (!runtime.DatabaseSync || !runtime.backup) {
      throw new AssetTrackError({ code: "sqlite.api_incomplete", status: 503 });
    }
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 16)) {
      throw new AssetTrackError({
        code: "sqlite.node_version_unsupported",
        status: 503,
        params: { node: process.versions.node }
      });
    }
    return runtime;
  } catch (error) {
    if (error instanceof AssetTrackError) throw error;
    throw new AssetTrackError({
      code: "sqlite.runtime_unavailable",
      status: 503,
      params: {
        node: process.versions.node,
        electron: process.versions.electron,
        reason: String(error)
      }
    });
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
      const columnInfo = db.prepare(`PRAGMA table_xinfo("${table}")`).all() as Array<{
        name: string;
        hidden?: number;
      }>;
      const columns = columnInfo.map((row) => row.name);
      const missing = REQUIRED_COLUMNS[table].filter(
        (column) => !columns.includes(column)
      );
      return missing.length ? [[table, missing]] : [];
    })
  );
  const invalidColumns = Object.fromEntries(
    Object.entries(REQUIRED_GENERATED_COLUMNS).flatMap(([table, columns]) => {
      if (missingTables.includes(table as typeof REQUIRED_TABLES[number])) return [];
      const columnInfo = db.prepare(`PRAGMA table_xinfo("${table}")`).all() as Array<{
        name: string;
        hidden?: number;
      }>;
      const invalid = columns.filter((column) => {
        const info = columnInfo.find((candidate) => candidate.name === column);
        return !info || info.hidden !== 3;
      });
      return invalid.length ? [[table, invalid]] : [];
    })
  );
  const indexRows = REQUIRED_INDEX_DEFINITIONS.flatMap((definition) => {
    if (missingTables.includes(definition.table)) return [];
    const row = (db.prepare(`PRAGMA index_list("${definition.table}")`).all() as Array<{
      name: string;
      unique: number;
    }>).find((candidate) => candidate.name === definition.name);
    if (!row) return [];
    const columns = (db.prepare(`PRAGMA index_info("${definition.name}")`).all() as Array<{
      seqno: number;
      name: string | null;
    }>).sort((left, right) => left.seqno - right.seqno).map((column) => column.name);
    return [{ definition, row, columns }];
  });
  const indexedNames = new Set(indexRows.map(({ definition }) => definition.name));
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !indexedNames.has(index));
  const invalidIndexes = indexRows.flatMap(({ definition, row, columns }) =>
    row.unique !== (definition.unique ? 1 : 0)
      || JSON.stringify(columns) !== JSON.stringify(definition.columns)
      ? [definition.name]
      : []
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
    && Object.keys(invalidColumns).length === 0
    && missingIndexes.length === 0
    && invalidIndexes.length === 0
    && missingForeignKeys.length === 0
    && (integrity === "ok" || integrity === "skipped")
    && (foreignKeyViolations === 0 || foreignKeyViolations === null);
  return {
    valid,
    schema_version: version,
    tables,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    invalid_columns: invalidColumns,
    missing_indexes: missingIndexes,
    invalid_indexes: invalidIndexes,
    missing_foreign_keys: missingForeignKeys,
    integrity_check: integrity,
    foreign_key_violations: foreignKeyViolations
  };
}

function validationError(validation: SchemaValidation): string {
  const columns = Object.entries(validation.missing_columns)
    .map(([table, missing]) => `${table}(${missing.join(",")})`)
    .join(";");
  return `仅支持完整 schema ${CURRENT_SCHEMA_VERSION} 数据库（schema ${PREVIOUS_SCHEMA_VERSION} 会在打开时迁移）；`
    + `版本=${validation.schema_version}，`
    + `缺少表=${validation.missing_tables.join(",") || "无"}，`
    + `缺少字段=${columns || "无"}，`
    + `非法字段=${Object.entries(validation.invalid_columns)
      .map(([table, columns]) => `${table}(${columns.join(",")})`).join(";") || "无"}，`
    + `缺少索引=${validation.missing_indexes.join(",") || "无"}，`
    + `非法索引=${validation.invalid_indexes.join(",") || "无"}，`
    + `缺少外键=${validation.missing_foreign_keys.join(",") || "无"}，`
    + `外键违规=${validation.foreign_key_violations ?? "未检查"}，`
    + `完整性=${validation.integrity_check}`;
}

export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();
  private restoring = false;
  private migrationReport: SchemaMigrationReport | null = null;

  constructor(private path: string) {}

  static inspect(path: string): DatabaseInspection {
    if (!existsSync(path)) {
      return { exists: false, valid: false, validation: null, error: null };
    }
    let db: DatabaseSync | null = null;
    try {
      const runtime = sqliteRuntime();
      db = new runtime.DatabaseSync(path, { readOnly: true, timeout: 5000 });
      registerSchemaFunctions(db);
      const validation = schemaValidation(db, true);
      return {
        exists: true,
        valid: validation.valid,
        migration_required: canMigrateSchema9(db),
        validation,
        error: validation.valid ? null : validationError(validation)
      };
    } catch (error) {
      return {
        exists: true,
        valid: false,
        validation: null,
        error: error instanceof AssetTrackError
          ? error
          : error instanceof Error
            ? error.message
            : String(error)
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
      registerSchemaFunctions(db);
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=5000");
      db.exec("PRAGMA journal_mode=WAL");
      const tables = this.tableNames(db);
      const version = Number(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
      );
      if (!tables.length && version !== 0) {
        throw new AssetTrackError({
          code: "database.empty_user_version",
          status: 422,
          params: { version }
        });
      }
      if (!tables.length) {
        db.exec("BEGIN IMMEDIATE");
        try {
          createSchema(db);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } else if (version === PREVIOUS_SCHEMA_VERSION) {
        const protectionBackup = this.createMigrationProtectionBackup(db, version);
        try {
          this.migrationReport = migrateSchema9To10(db);
          this.migrationReport.protection_backup_path = protectionBackup;
        } catch (error) {
          if (error instanceof SchemaMigrationError) {
            error.report.protection_backup_path = protectionBackup;
          }
          throw error;
        }
      }
      const validation = this.validateDatabase(db, false);
      if (!validation.valid) {
        throw new AssetTrackError({
          code: "database.validation_failed",
          status: 422,
          message: validationError(validation),
          params: { version: validation.schema_version }
        });
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
    if (this.restoring) {
      throw new AssetTrackError({
        code: "database.restoring",
        status: 423
      });
    }
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

  private createMigrationProtectionBackup(db: DatabaseSync, sourceVersion: number): string {
    const directory = join(dirname(this.path), "backups");
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let sequence = 0;
    let target: string;
    do {
      target = join(
        directory,
        `before-schema10-${stamp}${sequence ? `-${sequence}` : ""}.db`
      );
      sequence += 1;
    } while (existsSync(target));
    const escapedTarget = target.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escapedTarget}'`);
    const runtime = sqliteRuntime();
    const snapshot = new runtime.DatabaseSync(target, {
      readOnly: true,
      timeout: 5000
    });
    try {
      const version = Number(
        (snapshot.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      );
      const integrity = String(
        (snapshot.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }).integrity_check
      );
      const preservedTables = [
        "category_definitions",
        "account_definitions",
        "transactions",
        "cash_account_balances",
        "investment_account_balances",
        "fixed_assets",
        "debt_manager",
        "month_status"
      ];
      const countMismatch = preservedTables.find((table) => {
        const sourceCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
        const backupCount = Number((snapshot.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
        return sourceCount !== backupCount;
      });
      if (version !== sourceVersion || integrity !== "ok" || countMismatch) {
        throw new AssetTrackError({
          code: "database.snapshot_validation_failed",
          status: 422,
          params: {
            sourceVersion,
            version,
            integrity,
            countMismatch: countMismatch ?? ""
          }
        });
      }
    } finally {
      snapshot.close();
    }
    return target;
  }
}
