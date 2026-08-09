import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync
} from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  PREVIOUS_SCHEMA_VERSION,
  REQUIRED_COLUMNS,
  REQUIRED_CHECK_CONSTRAINTS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_GENERATED_COLUMNS,
  REQUIRED_INDEX_DEFINITIONS,
  REQUIRED_INDEXES,
  REQUIRED_PRIMARY_KEYS,
  REQUIRED_TABLES,
  REQUIRED_UNIQUE_CONSTRAINTS,
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
  invalid_primary_keys: string[];
  missing_unique_constraints: string[];
  missing_check_constraints: string[];
  missing_foreign_keys: string[];
  invalid_foreign_keys: string[];
  integrity_check: string;
  foreign_key_violations: number | null;
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  migration_required?: boolean;
  recovery_available?: boolean;
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

function normalizedSql(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s`"]+/g, "");
}

function constraintLabel(table: string, columns: readonly string[]): string {
  return `${table}(${columns.join(",")})`;
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
  const invalidPrimaryKeys = REQUIRED_PRIMARY_KEYS.flatMap((expected) => {
    if (missingTables.includes(expected.table)) return [];
    const columns = (db.prepare(`PRAGMA table_info("${expected.table}")`).all() as Array<{
      name: string;
      pk: number;
    }>)
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    return JSON.stringify(columns) === JSON.stringify(expected.columns)
      ? []
      : [constraintLabel(expected.table, expected.columns)];
  });
  const missingUniqueConstraints = REQUIRED_UNIQUE_CONSTRAINTS.flatMap((expected) => {
    if (missingTables.includes(expected.table)) return [];
    const present = (db.prepare(`PRAGMA index_list("${expected.table}")`).all() as Array<{
      name: string;
      unique: number;
      origin?: string;
    }>).some((index) => {
      if (index.unique !== 1 || index.origin !== "u") return false;
      const columns = (db.prepare(`PRAGMA index_info("${index.name}")`).all() as Array<{
        seqno: number;
        name: string | null;
      }>)
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name);
      return JSON.stringify(columns) === JSON.stringify(expected.columns);
    });
    return present ? [] : [constraintLabel(expected.table, expected.columns)];
  });
  const tableSql = new Map(
    REQUIRED_TABLES.flatMap((table) => {
      if (missingTables.includes(table)) return [];
      const row = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table) as { sql?: string | null } | undefined;
      return [[table, normalizedSql(row?.sql)] as const];
    })
  );
  const missingCheckConstraints = REQUIRED_CHECK_CONSTRAINTS.flatMap((expected) => {
    const sql = tableSql.get(expected.table);
    return sql?.includes(normalizedSql(expected.expression))
      ? []
      : [`${expected.table}:${expected.expression}`];
  });
  const missingForeignKeys = REQUIRED_FOREIGN_KEYS.flatMap((expected) => {
    if (missingTables.includes(expected.table)) {
      return [];
    }
    const foreignKeys = db.prepare(
      `PRAGMA foreign_key_list("${expected.table}")`
    ).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete?: string;
      on_update?: string;
    }>;
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
  const invalidForeignKeys = REQUIRED_FOREIGN_KEYS.flatMap((expected) => {
    if (missingTables.includes(expected.table)) return [];
    const foreignKeys = db.prepare(
      `PRAGMA foreign_key_list("${expected.table}")`
    ).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete?: string;
      on_update?: string;
    }>;
    const present = foreignKeys.some(
      (foreignKey) =>
        foreignKey.table === expected.targetTable
        && foreignKey.from === expected.from
        && foreignKey.to === expected.targetColumn
    );
    if (!present) return [];
    return foreignKeys.some(
      (foreignKey) =>
        foreignKey.table === expected.targetTable
        && foreignKey.from === expected.from
        && foreignKey.to === expected.targetColumn
        && String(foreignKey.on_delete ?? "NO ACTION").toUpperCase() === "NO ACTION"
        && String(foreignKey.on_update ?? "NO ACTION").toUpperCase() === "NO ACTION"
    )
      ? []
      : [`${expected.table}.${expected.from}`
        + `→${expected.targetTable}.${expected.targetColumn}`];
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
    && invalidPrimaryKeys.length === 0
    && missingUniqueConstraints.length === 0
    && missingCheckConstraints.length === 0
    && missingForeignKeys.length === 0
    && invalidForeignKeys.length === 0
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
    invalid_primary_keys: invalidPrimaryKeys,
    missing_unique_constraints: missingUniqueConstraints,
    missing_check_constraints: missingCheckConstraints,
    missing_foreign_keys: missingForeignKeys,
    invalid_foreign_keys: invalidForeignKeys,
    integrity_check: integrity,
    foreign_key_violations: foreignKeyViolations
  };
}

function isRecoverableDatabase(path: string): boolean {
  if (!existsSync(path)) return false;
  let db: DatabaseSync | null = null;
  try {
    const runtime = sqliteRuntime();
    db = new runtime.DatabaseSync(path, { readOnly: true, timeout: 5000 });
    registerSchemaFunctions(db);
    const validation = schemaValidation(db, true);
    return validation.valid || canMigrateSchema9(db);
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function recoveryArtifact(path: string): string | null {
  const rollback = `${path}.rollback`;
  if (isRecoverableDatabase(rollback)) return rollback;
  const incoming = `${path}.incoming`;
  if (isRecoverableDatabase(incoming)) return incoming;
  return null;
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
    + `非法主键=${validation.invalid_primary_keys.join(",") || "无"}，`
    + `缺少唯一约束=${validation.missing_unique_constraints.join(",") || "无"}，`
    + `缺少检查约束=${validation.missing_check_constraints.join(",") || "无"}，`
    + `缺少外键=${validation.missing_foreign_keys.join(",") || "无"}，`
    + `非法外键=${validation.invalid_foreign_keys.join(",") || "无"}，`
    + `外键违规=${validation.foreign_key_violations ?? "未检查"}，`
    + `完整性=${validation.integrity_check}`;
}

export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();
  private restoring = false;
  private acceptingWrites = true;
  private migrationReport: SchemaMigrationReport | null = null;

  constructor(private path: string) {}

  static inspect(path: string): DatabaseInspection {
    if (!existsSync(path)) {
      return {
        exists: false,
        valid: false,
        ...(recoveryArtifact(path) ? { recovery_available: true } : {}),
        validation: null,
        error: null
      };
    }
    let db: DatabaseSync | null = null;
    try {
      const runtime = sqliteRuntime();
      db = new runtime.DatabaseSync(path, { readOnly: true, timeout: 5000 });
      registerSchemaFunctions(db);
      const validation = schemaValidation(db, true);
      const migrationRequired = canMigrateSchema9(db);
      return {
        exists: true,
        valid: validation.valid,
        migration_required: migrationRequired,
        ...(!validation.valid && !migrationRequired && recoveryArtifact(path)
          ? { recovery_available: true }
          : {}),
        validation,
        error: validation.valid ? null : validationError(validation)
      };
    } catch (error) {
      return {
        exists: true,
        valid: false,
        ...(recoveryArtifact(path) ? { recovery_available: true } : {}),
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
    if (!this.restoring) this.recoverRestoreArtifacts();
    const runtime = sqliteRuntime();
    mkdirSync(dirname(this.path), { recursive: true });
    const db = new runtime.DatabaseSync(this.path, {
      open: true,
      readOnly: false,
      timeout: 5000
    });
    let migrationProtectionBackup: string | null = null;
    try {
      registerSchemaFunctions(db);
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=5000");
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
        migrationProtectionBackup = protectionBackup;
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
      db.exec("PRAGMA journal_mode=WAL");
      this.db = db;
      this.acceptingWrites = true;
      return db;
    } catch (error) {
      db.close();
      if (migrationProtectionBackup && existsSync(migrationProtectionBackup)) {
        rmSync(`${this.path}-wal`, { force: true });
        rmSync(`${this.path}-shm`, { force: true });
        copyFileSync(migrationProtectionBackup, this.path);
      }
      throw error;
    }
  }

  connection(): DatabaseSync {
    if (this.restoring || !this.acceptingWrites) {
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
    this.acceptingWrites = false;
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  async reopen(): Promise<void> {
    this.acceptingWrites = false;
    await this.drain();
    this.close();
    this.open();
    this.acceptingWrites = true;
  }

  async withRestoreLock<T>(
    operation: () => Promise<T>,
    beforeClose?: () => Promise<void>
  ): Promise<T> {
    this.acceptingWrites = false;
    await this.drain();
    try {
      // The callback runs after the write queue has drained but before the
      // connection is closed. This lets restore create its safety snapshot
      // while the restore lock already blocks every new write.
      await beforeClose?.();
      this.restoring = true;
      this.close();
      return await operation();
    } finally {
      this.restoring = false;
      this.acceptingWrites = true;
    }
  }

  async snapshot(targetPath: string): Promise<void> {
    await this.drain();
    mkdirSync(dirname(targetPath), { recursive: true });
    const db = this.db ?? this.open();
    await sqliteRuntime().backup(db, targetPath);
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

  private recoverRestoreArtifacts(): void {
    const rollback = `${this.path}.rollback`;
    const incoming = `${this.path}.incoming`;
    const wal = `${this.path}-wal`;
    const shm = `${this.path}-shm`;
    const targetExists = existsSync(this.path);
    const targetValid = targetExists && isRecoverableDatabase(this.path);
    const rollbackExists = existsSync(rollback);
    const incomingExists = existsSync(incoming);
    const rollbackValid = rollbackExists && isRecoverableDatabase(rollback);
    const incomingValid = incomingExists && isRecoverableDatabase(incoming);

    // A valid installed target is authoritative. Only remove sidecars after
    // all candidate validation is complete, so an invalid rollback cannot
    // cause a valid incoming restore candidate to be deleted.
    if (targetValid) {
      rmSync(rollback, { force: true });
      rmSync(incoming, { force: true });
      return;
    }

    // An incoming database is the user's requested restore and therefore has
    // priority over the old target kept in rollback. This covers a crash after
    // target validation failed but before the incoming file was installed.
    const selected = incomingValid
      ? incoming
      : rollbackValid
        ? rollback
        : null;
    if (!selected) {
      if (rollbackExists) rmSync(rollback, { force: true });
      if (incomingExists) rmSync(incoming, { force: true });
      return;
    }

    const displaced = targetExists
      ? `${this.path}.recovery-invalid-${process.pid}-${Date.now()}`
      : null;
    try {
      rmSync(wal, { force: true });
      rmSync(shm, { force: true });
      if (displaced) renameSync(this.path, displaced);
      renameSync(selected, this.path);
      if (displaced) rmSync(displaced, { force: true });
      if (selected !== rollback) rmSync(rollback, { force: true });
      if (selected !== incoming) rmSync(incoming, { force: true });
    } catch (error) {
      // Keep the valid candidate available for the next open and restore the
      // malformed target when installation did not complete.
      if (existsSync(this.path) && selected !== this.path) {
        try { renameSync(this.path, selected); } catch { /* preserve original error */ }
      }
      if (displaced && existsSync(displaced) && !existsSync(this.path)) {
        try { renameSync(displaced, this.path); } catch { /* preserve original error */ }
      }
      throw error;
    }
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
