import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";
import { DatabaseManager } from "../database/DatabaseManager";
import {
  BACKUP_FORMAT_VERSION,
  REQUIRED_TABLES
} from "../database/schema";
import { AssetTrackError } from "../application/errors";
import { loadSqliteModule } from "./desktopRuntime";
import { scalarText } from "../domain/text";

type Row = Record<string, unknown>;

const DATABASE_NAME = "accounting_system.db";
const MANIFEST_NAME = "manifest.json";
const MAX_MEMBERS = 128;
const MAX_UNCOMPRESSED = 512 * 1024 * 1024;

const CONFIG = [
  {
    name: "transactions",
    filename: "transactions_backup.csv",
    columns: [
      "month", "transaction_date", "type", "category_key",
      "category", "counterparty", "product", "source", "amount"
    ]
  },
  {
    name: "category_definitions",
    filename: "category_definitions_backup.csv",
    columns: [
      "category_key", "name", "description", "transaction_type", "necessity", "pattern",
      "is_big_ticket", "color", "is_active", "sort_order"
    ]
  },
  {
    name: "account_definitions",
    filename: "account_definitions_backup.csv",
    columns: ["account_key", "name", "account_type", "is_active", "sort_order"]
  },
  {
    name: "cash_account_balances",
    filename: "cash_account_balances_backup.csv",
    columns: ["month", "account_key", "balance"]
  },
  {
    name: "investment_account_balances",
    filename: "investment_account_balances_backup.csv",
    columns: ["month", "account_key", "principal", "market_value", "cash_balance"]
  },
  {
    name: "fixed_assets",
    filename: "fixed_assets_backup.csv",
    columns: [
      "month", "asset_key", "asset_name", "category", "purchase_date",
      "purchase_price", "status", "note"
    ]
  },
  {
    name: "debt_manager",
    filename: "debts_backup.csv",
    columns: [
      "description", "counterparty", "amount", "start_date", "is_paid", "paid_date"
    ]
  },
  {
    name: "auto_rules",
    filename: "auto_rules_backup.csv",
    columns: [
      "id", "transaction_type", "match_scope", "counterparty", "product",
      "match_counterparty_key", "match_product_key", "rewrite_merchant",
      "rewrite_product", "category_key", "category"
    ]
  },
  {
    name: "month_status",
    filename: "month_status_backup.csv",
    columns: [
      "month", "status", "locked_at", "updated_at",
      "fixed_assets_initialized", "revision"
    ]
  },
  {
    name: "operation_logs",
    filename: "operation_logs_backup.csv",
    columns: [
      "id", "operation_id", "created_at", "actor", "operation_type", "source_page",
      "business_tab", "selection_json", "total_count", "success_count",
      "skipped_count", "failure_count", "details_json"
    ]
  }
] as const;

interface Manifest {
  format_version: number;
  schema_version: number;
  app_version: string;
  created_at: string;
  required_tables: string[];
  tables: Record<string, {
    rows: number;
    filename: string;
    columns: readonly string[];
    content_sha256: string;
  }>;
  files: Record<string, { size: number; sha256: string }>;
  source_revision?: string | null;
  backup_version?: number;
  integrity_check?: string;
}

export interface BackupValidation {
  valid: true;
  mode: "complete" | "sqlite";
  schema: {
    valid: true;
    integrity_check: "ok";
    missing_tables: string[];
    schema_version: number;
  };
  row_counts: Record<string, number>;
  manifest: Manifest | null;
  format_version: number;
  required_tables: string[];
}

function fail(code: string, params: Record<string, unknown> = {}): never {
  throw new AssetTrackError({
    code,
    status: 422,
    params
  });
}

function timestamp(date = new Date()): string {
  const base = date.toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace("T", "-")
    .replace("Z", "");
  const [seconds, fraction = "000"] = base.split(".");
  return `${seconds}-${fraction.padEnd(6, "0")}`;
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = scalarText(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll("\"", "\"\"")}"` : raw;
}

function writeTableCsv(
  db: DatabaseSync,
  table: string,
  columns: readonly string[],
  path: string
): Row[] {
  const tableColumns = (db.prepare(`PRAGMA table_info(${table})`).all() as Row[])
    .map((row) => String(row.name));
  const order = tableColumns.includes("id") ? " ORDER BY id" : "";
  const result = db.prepare(
    `SELECT ${columns.join(",")} FROM ${table}${order}`
  ).all() as Row[];
  const content = [
    columns.join(","),
    ...result.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\r\n") + "\r\n";
  writeFileSync(path, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(content, "utf8")
  ]));
  return result;
}

function numericIndexes(
  db: DatabaseSync,
  table: string,
  columns: readonly string[]
): Set<number> {
  const types = new Map(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Row[])
      .map((row) => [String(row.name), String(row.type).toUpperCase()])
  );
  return new Set(columns.flatMap((column, index) =>
    ["INT", "REAL", "FLOA", "DOUB", "NUM", "DEC"].some(
      (marker) => (types.get(column) ?? "").includes(marker)
    ) ? [index] : []
  ));
}

function pythonFloat(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  return String(value);
}

function canonicalDigest(
  values: unknown[][],
  numeric: Set<number>
): string {
  const payload = `[${values.map((row) =>
    `[${row.map((value, index) => {
      if (value === null || value === undefined || value === "") return "null";
      if (numeric.has(index)) {
        const number = Number(value);
        if (Number.isFinite(number)) {
          const rounded = Number(number.toFixed(12));
          return pythonFloat(rounded);
        }
      }
      return JSON.stringify(value);
    }).join(",")}]`
  ).join(",")}]`;
  return sha256Buffer(Buffer.from(payload, "utf8"));
}

function tableDigest(
  db: DatabaseSync,
  table: string,
  columns: readonly string[]
): string {
  const tableColumns = (db.prepare(`PRAGMA table_info(${table})`).all() as Row[])
    .map((row) => String(row.name));
  const order = tableColumns.includes("id") ? " ORDER BY id" : "";
  const result = db.prepare(
    `SELECT ${columns.join(",")} FROM ${table}${order}`
  ).all() as Row[];
  return canonicalDigest(
    result.map((row) => columns.map((column) => row[column])),
    numericIndexes(db, table, columns)
  );
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function unzip(buffer: Buffer, destination: string): void {
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) fail("backup.zip.directory_invalid");
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count > MAX_MEMBERS) fail("backup.zip.member_limit", { limit: MAX_MEMBERS });
  let cursor = centralOffset;
  let total = 0;
  const root = resolve(destination);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("backup.zip.central_directory_invalid");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    total += size;
    if (total > MAX_UNCOMPRESSED) fail("backup.zip.uncompressed_limit", { limit: MAX_UNCOMPRESSED });
    const output = resolve(destination, name);
    if (output !== root && !output.startsWith(`${root}${sep}`)) {
      fail("backup.zip.unsafe_path", { path: name });
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail("backup.zip.local_directory_invalid");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 8
      ? inflateRawSync(compressed)
      : method === 0 ? compressed : fail("backup.zip.compression_unsupported", { method });
    if (data.length !== size) fail("backup.zip.size_mismatch", { path: name });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
}

function validateSqlite(path: string): BackupValidation["schema"] {
  const inspection = DatabaseManager.inspect(path);
  if (!inspection.valid || !inspection.validation) {
    fail("backup.schema_invalid", { reason: inspection.error ?? null });
  }
  return {
    valid: true,
    integrity_check: "ok",
    missing_tables: inspection.validation.missing_tables,
    schema_version: inspection.validation.schema_version
  };
}

function parseCsv(path: string): { headers: string[]; rows: string[][] } {
  const content = readFileSync(path, "utf8").replace(/^\ufeff/, "");
  const result: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"") {
      if (quoted && content[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) result.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value);
    result.push(row);
  }
  return { headers: result[0] ?? [], rows: result.slice(1) };
}

async function materialize(source: string): Promise<{
  root: string;
  cleanup(): void;
}> {
  const resolved = resolve(source);
  if (!existsSync(resolved)) fail("backup.source_missing", { path: resolved });
  if (statSync(resolved).isDirectory()) {
    return { root: resolved, cleanup: () => undefined };
  }
  const temporary = mkdtempSync(join(tmpdir(), "asset-track-restore-"));
  try {
    if (resolved.toLocaleLowerCase("en-US").endsWith(".zip")) {
      unzip(readFileSync(resolved), temporary);
    } else if (/\.(db|sqlite|sqlite3)$/i.test(resolved)) {
      const runtime = loadSqliteModule();
      const sourceDb = new runtime.DatabaseSync(resolved, { readOnly: true });
      try {
        await runtime.backup(sourceDb, join(temporary, DATABASE_NAME));
      } finally {
        sourceDb.close();
      }
    } else {
      fail("backup.source_unsupported", { path: resolved });
    }
    return {
      root: temporary,
      cleanup: () => rmSync(temporary, { recursive: true, force: true })
    };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export class BackupService {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly appVersion: string
  ) {}

  private buildManifest(root: string, db: DatabaseSync): Manifest {
    const validation = validateSqlite(join(root, DATABASE_NAME));
    const files: Manifest["files"] = {};
    const databasePath = join(root, DATABASE_NAME);
    files[DATABASE_NAME] = {
      size: statSync(databasePath).size,
      sha256: sha256File(databasePath)
    };
    const tables: Manifest["tables"] = {};
    for (const config of CONFIG) {
      const path = join(root, config.filename);
      const rowCount = Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM ${config.name}`).get() as Row).count
      );
      files[config.filename] = {
        size: statSync(path).size,
        sha256: sha256File(path)
      };
      tables[config.name] = {
        rows: rowCount,
        filename: config.filename,
        columns: config.columns,
        content_sha256: tableDigest(db, config.name, config.columns)
      };
    }
    return {
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: validation.schema_version,
      app_version: this.appVersion,
      created_at: new Date().toISOString(),
      required_tables: [...REQUIRED_TABLES],
      tables,
      files
    };
  }

  async exportZip(directory: string): Promise<{
    path: string;
    validation: BackupValidation;
  }> {
    const targetDirectory = resolve(directory);
    mkdirSync(targetDirectory, { recursive: true });
    const temporary = mkdtempSync(join(tmpdir(), "asset-track-backup-"));
    try {
      const snapshot = join(temporary, DATABASE_NAME);
      await this.manager.snapshot(snapshot);
      validateSqlite(snapshot);
      const runtime = loadSqliteModule();
      const db = new runtime.DatabaseSync(snapshot, { readOnly: true });
      try {
        for (const config of CONFIG) {
          writeTableCsv(db, config.name, config.columns, join(temporary, config.filename));
        }
        const manifest = this.buildManifest(temporary, db);
        writeFileSync(
          join(temporary, MANIFEST_NAME),
          JSON.stringify(manifest, null, 2),
          "utf8"
        );
      } finally {
        db.close();
      }
      const fileNames = [
        DATABASE_NAME,
        ...CONFIG.map((config) => config.filename),
        MANIFEST_NAME
      ].sort();
      const output = join(
        targetDirectory,
        `asset-track-backup-${timestamp()}.zip`
      );
      const pending = `${output}.tmp`;
      writeFileSync(pending, zipFiles(fileNames.map((name) => ({
        name,
        data: readFileSync(join(temporary, name))
      }))));
      renameSync(pending, output);
      return { path: output, validation: await this.validate(output) };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  async validate(source: string): Promise<BackupValidation> {
    const materialized = await materialize(source);
    try {
      const databasePath = join(materialized.root, DATABASE_NAME);
      if (!existsSync(databasePath)) {
        fail("backup.database_missing");
      }
      const schema = validateSqlite(databasePath);
      const manifestPath = join(materialized.root, MANIFEST_NAME);
      const hasManifest = existsSync(manifestPath);
      let manifest: Manifest | null = null;
      if (hasManifest) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
        } catch (error) {
          fail("backup.manifest_unreadable", { cause: String(error) });
        }
        if (manifest.format_version !== BACKUP_FORMAT_VERSION) {
          fail("backup.format_unsupported", { version: manifest.format_version });
        }
        if (JSON.stringify(manifest.required_tables) !== JSON.stringify(REQUIRED_TABLES)) {
          fail("backup.manifest_tables_invalid");
        }
        if (
          JSON.stringify(Object.keys(manifest.tables).sort())
          !== JSON.stringify([...REQUIRED_TABLES].sort())
        ) {
          fail("backup.manifest_summary_invalid");
        }
        for (const [filename, metadata] of Object.entries(manifest.files)) {
          const path = join(materialized.root, filename);
          if (!existsSync(path) || sha256File(path) !== metadata.sha256) {
            fail("backup.file_digest_mismatch", { filename });
          }
        }
      }
      const runtime = loadSqliteModule();
      const db = new runtime.DatabaseSync(databasePath, { readOnly: true });
      try {
        const rowCounts: Record<string, number> = {};
        for (const config of CONFIG) {
          const databaseCount = Number(
            (db.prepare(`SELECT COUNT(*) AS count FROM ${config.name}`).get() as Row).count
          );
          rowCounts[config.name] = databaseCount;
          if (!manifest) continue;
          const metadata = manifest.tables[config.name];
          const csvPath = join(materialized.root, metadata.filename);
          if (!existsSync(csvPath)) fail("backup.csv_missing", { filename: basename(csvPath) });
          const csv = parseCsv(csvPath);
          if (JSON.stringify(csv.headers) !== JSON.stringify(config.columns)) {
            fail("backup.csv_columns_mismatch", { filename: basename(csvPath) });
          }
          if (csv.rows.length !== databaseCount || metadata.rows !== databaseCount) {
            fail("backup.row_count_mismatch", { table: config.name });
          }
          const databaseDigest = tableDigest(db, config.name, config.columns);
          const csvDigest = canonicalDigest(
            csv.rows,
            numericIndexes(db, config.name, config.columns)
          );
          if (
            databaseDigest !== csvDigest
            || ![databaseDigest, csvDigest].includes(metadata.content_sha256)
          ) {
            fail("backup.content_digest_mismatch", { table: config.name });
          }
        }
        return {
          valid: true,
          mode: manifest ? "complete" : "sqlite",
          schema,
          row_counts: rowCounts,
          manifest,
          format_version: BACKUP_FORMAT_VERSION,
          required_tables: [...REQUIRED_TABLES]
        };
      } finally {
        db.close();
      }
    } finally {
      materialized.cleanup();
    }
  }

  private async exportSafetyDirectory(directory: string): Promise<void> {
    mkdirSync(directory, { recursive: true });
    const databasePath = join(directory, DATABASE_NAME);
    await this.manager.snapshot(databasePath);
    const runtime = loadSqliteModule();
    const db = new runtime.DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const config of CONFIG) {
        writeTableCsv(db, config.name, config.columns, join(directory, config.filename));
      }
      const manifest = this.buildManifest(directory, db);
      manifest.source_revision = null;
      manifest.backup_version = BACKUP_FORMAT_VERSION;
      manifest.integrity_check = "ok";
      writeFileSync(join(directory, MANIFEST_NAME), JSON.stringify(manifest, null, 2), "utf8");
    } finally {
      db.close();
    }
  }

  async restore(source: string): Promise<Record<string, unknown>> {
    const validation = await this.validate(source);
    const materialized = await materialize(source);
    try {
      const incomingSource = join(materialized.root, DATABASE_NAME);
      const target = this.manager.getPath();
      const incoming = `${target}.incoming`;
      const rollback = `${target}.rollback`;
      const safety = join(
        dirname(target),
        "backups",
        `before-restore-${timestamp()}`
      );
      rmSync(incoming, { force: true });
      const runtime = loadSqliteModule();
      const sourceDb = new runtime.DatabaseSync(incomingSource, { readOnly: true });
      try {
        await runtime.backup(sourceDb, incoming);
      } finally {
        sourceDb.close();
      }
      validateSqlite(incoming);
      if (existsSync(target)) await this.exportSafetyDirectory(safety);
      await this.manager.withRestoreLock(async () => {
        rmSync(`${target}-wal`, { force: true });
        rmSync(`${target}-shm`, { force: true });
        rmSync(rollback, { force: true });
        if (existsSync(target)) renameSync(target, rollback);
        try {
          renameSync(incoming, target);
          this.manager.open();
          validateSqlite(target);
          rmSync(rollback, { force: true });
        } catch (error) {
          this.manager.close();
          rmSync(target, { force: true });
          if (existsSync(rollback)) renameSync(rollback, target);
          this.manager.open();
          throw error;
        }
      });
      return {
        mode: validation.mode,
        row_counts: validation.row_counts,
        safety_snapshot: existsSync(safety) ? safety : null
      };
    } finally {
      materialized.cleanup();
    }
  }
}
