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
import type {
  BackupManifest,
  BackupRestoreResult,
  BackupValidation
} from "../types/backup";

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
      "id", "month", "transaction_date", "type", "category_key",
      "category", "counterparty", "product", "source", "account_key", "amount"
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
      "id", "month", "asset_key", "asset_name", "category", "purchase_date",
      "purchase_price", "status", "note"
    ]
  },
  {
    name: "debt_manager",
    filename: "debts_backup.csv",
    columns: [
      "id", "description", "counterparty", "amount", "start_date", "is_paid", "paid_date"
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
  },
  {
    name: "attribute_groups",
    filename: "attribute_groups_backup.csv",
    columns: ["group_key", "name", "selection_mode", "is_active", "sort_order"]
  },
  {
    name: "attribute_options",
    filename: "attribute_options_backup.csv",
    columns: ["attribute_key", "group_key", "name", "is_active", "sort_order"]
  },
  {
    name: "category_attributes",
    filename: "category_attributes_backup.csv",
    columns: ["category_key", "attribute_key"]
  },
  {
    name: "tags",
    filename: "tags_backup.csv",
    columns: ["tag_key", "name", "description", "color", "is_active", "sort_order"]
  },
  {
    name: "transaction_tags",
    filename: "transaction_tags_backup.csv",
    columns: ["transaction_id", "tag_key"]
  }
] as const;

// Schema 11 complete backups contain the first ten tables. They remain
// readable so a user can verify and restore an old backup through the same
// protected migration path as an old live database.
const LEGACY_CONFIG = CONFIG.slice(0, 10);

type Manifest = BackupManifest;

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

function uniquePath(base: string): string {
  if (!existsSync(base) && !existsSync(`${base}.tmp`)) return base;
  let sequence = 1;
  let candidate = `${base}-${sequence}`;
  while (existsSync(candidate) || existsSync(`${candidate}.tmp`)) {
    sequence += 1;
    candidate = `${base}-${sequence}`;
  }
  return candidate;
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

interface FileFingerprint {
  size: number;
  mtimeMs: number;
  sha256: string;
}

function fingerprintFile(path: string): FileFingerprint {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    fail("backup.source_changed", { path, cause: String(error) });
  }
  if (!stats.isFile()) fail("backup.source_changed", { path });
  try {
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: sha256File(path)
    };
  } catch (error) {
    fail("backup.source_changed", { path, cause: String(error) });
  }
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256;
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
  const ensureRange = (offset: number, length: number, code: string): void => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
      || offset < 0 || length < 0 || offset > buffer.length - length) {
      fail(code);
    }
  };
  let endOffset = -1;
  const endSearchStart = Math.max(0, buffer.length - 22);
  const endSearchStop = Math.max(0, buffer.length - 65557);
  for (let index = endSearchStart; index >= endSearchStop; index -= 1) {
    if (index + 22 > buffer.length) continue;
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) fail("backup.zip.directory_invalid");
  ensureRange(endOffset, 22, "backup.zip.directory_invalid");
  const commentLength = buffer.readUInt16LE(endOffset + 20);
  ensureRange(endOffset + 22, commentLength, "backup.zip.directory_invalid");
  const count = buffer.readUInt16LE(endOffset + 10);
  if (buffer.readUInt16LE(endOffset + 8) !== count) {
    fail("backup.zip.directory_invalid");
  }
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count > MAX_MEMBERS) fail("backup.zip.member_limit", { limit: MAX_MEMBERS });
  ensureRange(centralOffset, centralSize, "backup.zip.central_directory_invalid");
  if (centralOffset + centralSize > endOffset) {
    fail("backup.zip.central_directory_invalid");
  }
  let cursor = centralOffset;
  let total = 0;
  const names = new Set<string>();
  const outputs = new Set<string>();
  const localOffsets = new Set<number>();
  const root = resolve(destination);
  for (let index = 0; index < count; index += 1) {
    ensureRange(cursor, 46, "backup.zip.central_directory_invalid");
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("backup.zip.central_directory_invalid");
    const method = buffer.readUInt16LE(cursor + 10);
    const flags = buffer.readUInt16LE(cursor + 8);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const centralEntryLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(cursor, centralEntryLength, "backup.zip.central_directory_invalid");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (!name || name.endsWith("/") || names.has(name)) {
      fail("backup.zip.duplicate_member", { path: name });
    }
    if (name.includes("\\") || name.includes("\0")) {
      fail("backup.zip.unsafe_path", { path: name });
    }
    names.add(name);
    if (size > MAX_UNCOMPRESSED - total) {
      fail("backup.zip.uncompressed_limit", { limit: MAX_UNCOMPRESSED });
    }
    total += size;
    const output = resolve(destination, name);
    if (output === root || !output.startsWith(`${root}${sep}`) || outputs.has(output)) {
      fail("backup.zip.unsafe_path", { path: name });
    }
    outputs.add(output);
    ensureRange(localOffset, 30, "backup.zip.local_directory_invalid");
    if (localOffsets.has(localOffset)) {
      fail("backup.zip.duplicate_member", { path: name });
    }
    localOffsets.add(localOffset);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail("backup.zip.local_directory_invalid");
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    ensureRange(localOffset, 30 + localNameLength + localExtraLength, "backup.zip.local_directory_invalid");
    if (localOffset >= centralOffset || start > centralOffset
      || compressedSize > centralOffset - start) {
      fail("backup.zip.local_data_invalid", { path: name });
    }
    ensureRange(start, compressedSize, "backup.zip.local_data_invalid");
    const localName = buffer.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength
    ).toString("utf8");
    if (localName !== name || localMethod !== method) {
      fail("backup.zip.local_directory_invalid", { path: name });
    }
    // Backups produced by zipFiles do not use data descriptors. Accepting a
    // descriptor here would make the central directory the only trustworthy
    // size source, so reject mismatched local metadata unless the flags
    // explicitly opt into that format.
    if ((flags & 0x0008) === 0
      && (localFlags !== flags || localCrc !== crc
        || localCompressedSize !== compressedSize || localSize !== size)) {
      fail("backup.zip.local_directory_invalid", { path: name });
    }
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 8
      ? inflateRawSync(compressed)
      : method === 0 ? compressed : fail("backup.zip.compression_unsupported", { method });
    if (data.length !== size || crc32(data) !== crc) {
      fail("backup.zip.size_mismatch", { path: name });
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, data);
    cursor += centralEntryLength;
  }
  if (cursor !== centralOffset + centralSize) {
    fail("backup.zip.central_directory_invalid");
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

async function stageCurrentDatabase(path: string): Promise<{
  path: string;
  cleanup: () => void;
}> {
  const inspection = DatabaseManager.inspect(path);
  if (inspection.valid) return { path, cleanup: () => undefined };
  if (!inspection.migration_required) {
    fail("backup.schema_invalid", { reason: inspection.error ?? null });
  }
  const temporary = mkdtempSync(join(tmpdir(), "asset-track-backup-migration-"));
  const staged = join(temporary, DATABASE_NAME);
  const runtime = loadSqliteModule();
  const sourceDb = new runtime.DatabaseSync(path, { readOnly: true });
  try {
    await runtime.backup(sourceDb, staged);
  } finally {
    sourceDb.close();
  }
  const manager = new DatabaseManager(staged);
  try {
    manager.open({ preserveLegacyAttributes: true });
    manager.close();
    validateSqlite(staged);
  } catch (error) {
    manager.close();
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    path: staged,
    cleanup: () => rmSync(temporary, { recursive: true, force: true })
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
    return this.manager.withExclusiveControl(async () => {
      const targetDirectory = resolve(directory);
      mkdirSync(targetDirectory, { recursive: true });
      const temporary = mkdtempSync(join(tmpdir(), "asset-track-backup-"));
      try {
        const snapshot = join(temporary, DATABASE_NAME);
        await this.manager.snapshotWithinControlLock(snapshot);
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
        const output = uniquePath(join(
          targetDirectory,
          `asset-track-backup-${timestamp()}.zip`
        ));
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
    });
  }

  async validate(source: string): Promise<BackupValidation> {
    const materialized = await materialize(source);
    try {
      const databasePath = join(materialized.root, DATABASE_NAME);
      if (!existsSync(databasePath)) {
        fail("backup.database_missing");
      }
      const manifestPath = join(materialized.root, MANIFEST_NAME);
      const hasManifest = existsSync(manifestPath);
      let manifest: Manifest | null = null;
      if (hasManifest) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
        } catch (error) {
          fail("backup.manifest_unreadable", { cause: String(error) });
        }
        if (manifest.format_version !== BACKUP_FORMAT_VERSION
          && manifest.format_version !== 8) {
          fail("backup.format_unsupported", { version: manifest.format_version });
        }
      }
      const sourceInspection = DatabaseManager.inspect(databasePath);
      const legacyManifest = manifest?.format_version === 8
        || (manifest === null && sourceInspection.migration_required === true);
      const configs = legacyManifest ? LEGACY_CONFIG : CONFIG;
      const expectedTables = legacyManifest
        ? LEGACY_CONFIG.map((config) => config.name)
        : [...REQUIRED_TABLES];
      if (manifest && JSON.stringify(manifest.required_tables) !== JSON.stringify(expectedTables)) {
        fail("backup.manifest_tables_invalid");
      }
      if (manifest && JSON.stringify(Object.keys(manifest.tables).sort())
        !== JSON.stringify([...expectedTables].sort())) {
        fail("backup.manifest_summary_invalid");
      }
      if (manifest) {
        const expectedFileNames = [
          DATABASE_NAME,
          ...configs.map((config) => config.filename)
        ].sort();
        if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expectedFileNames)) {
          fail("backup.manifest_files_invalid");
        }
        for (const config of configs) {
          const metadata = manifest.tables[config.name];
          if (!metadata || metadata.filename !== config.filename
            || JSON.stringify(metadata.columns) !== JSON.stringify(config.columns)) {
            fail("backup.manifest_summary_invalid");
          }
        }
        for (const [filename, metadata] of Object.entries(manifest.files)) {
          const path = join(materialized.root, filename);
          if (!existsSync(path) || sha256File(path) !== metadata.sha256) {
            fail("backup.file_digest_mismatch", { filename });
          }
        }
      }
      const staged = await stageCurrentDatabase(databasePath);
      const schema = validateSqlite(staged.path);
      const runtime = loadSqliteModule();
      const sourceDb = new runtime.DatabaseSync(databasePath, { readOnly: true });
      try {
        const rowCounts: Record<string, number> = {};
        for (const config of configs) {
          const databaseCount = Number(
            (sourceDb.prepare(`SELECT COUNT(*) AS count FROM ${config.name}`).get() as Row).count
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
          const databaseDigest = tableDigest(sourceDb, config.name, config.columns);
          const csvDigest = canonicalDigest(
            csv.rows,
            numericIndexes(sourceDb, config.name, config.columns)
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
          format_version: manifest?.format_version ?? BACKUP_FORMAT_VERSION,
          required_tables: manifest?.required_tables ?? [...REQUIRED_TABLES]
        };
      } finally {
        sourceDb.close();
        if (staged.path !== databasePath) staged.cleanup();
      }
    } finally {
      materialized.cleanup();
    }
  }

  private async exportSafetyDirectory(directory: string, controlLockHeld = false): Promise<void> {
    mkdirSync(directory, { recursive: true });
    const databasePath = join(directory, DATABASE_NAME);
    if (controlLockHeld) {
      await this.manager.snapshotWithinControlLock(databasePath);
    } else {
      await this.manager.snapshot(databasePath);
    }
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

  async restore(
    source: string,
    beforeCommit?: () => void
  ): Promise<BackupRestoreResult> {
    let materializedCleanup: (() => void) | null = null;
    let validation: BackupValidation | null = null;
    let incomingSource = "";
    const target = this.manager.getPath();
    const incoming = `${target}.incoming`;
    const rollback = `${target}.rollback`;
    let safety = "";
    let hadTarget = false;
    try {
      await this.manager.withRestoreLock(async () => {
        let originalMoved = false;
        let candidateInstalled = false;
        try {
          beforeCommit?.();
          rmSync(`${target}-wal`, { force: true });
          rmSync(`${target}-shm`, { force: true });
          rmSync(rollback, { force: true });
          if (existsSync(target)) {
            renameSync(target, rollback);
            originalMoved = true;
          }
          renameSync(incoming, target);
          candidateInstalled = true;
          this.manager.open();
          validateSqlite(target);
          rmSync(rollback, { force: true });
        } catch (error) {
          this.manager.close();
          if (candidateInstalled) {
            rmSync(target, { force: true });
          }
          if (originalMoved && existsSync(rollback)) {
            renameSync(rollback, target);
          }
          if (hadTarget) {
            this.manager.open();
          }
          throw error;
        }
      }, async () => {
        // Materialize and validate the source while the control lock is held.
        // Otherwise two restore calls can race while writing the shared
        // `.incoming` candidate, and a backup/export can interleave between
        // validation and installation.
        const prepared = await materialize(source);
        materializedCleanup = () => prepared.cleanup();
        validation = await this.validate(prepared.root);
        incomingSource = join(prepared.root, DATABASE_NAME);
        rmSync(incoming, { force: true });
        // A directory backup is user-controlled input and can change after
        // validation. Capture an identity immediately before opening it and
        // compare again after the SQLite backup finishes; a changed source is
        // rejected instead of installing a mixed snapshot.
        const sourceBeforeCopy = fingerprintFile(incomingSource);
        const runtime = loadSqliteModule();
        const sourceDb = new runtime.DatabaseSync(incomingSource, { readOnly: true });
        try {
          await runtime.backup(sourceDb, incoming);
        } finally {
          sourceDb.close();
        }
        if (!sameFingerprint(sourceBeforeCopy, fingerprintFile(incomingSource))) {
          rmSync(incoming, { force: true });
          fail("backup.source_changed", { path: incomingSource });
        }
        const incomingInspection = DatabaseManager.inspect(incoming);
        if (!incomingInspection.valid && !incomingInspection.migration_required) {
          fail("backup.schema_invalid", { reason: incomingInspection.error ?? null });
        }
        // The safety snapshot must be created after the restore lock drains
        // the write queue. Otherwise a write committed between the snapshot
        // and the swap could be silently overwritten without being present in
        // either the restored database or the safety copy.
        hadTarget = existsSync(target);
        if (hadTarget) {
          safety = uniquePath(join(
            dirname(target),
            "backups",
            `before-restore-${timestamp()}`
          ));
          await this.exportSafetyDirectory(safety, true);
        }
      });
      return {
        mode: validation!.mode,
        row_counts: validation!.row_counts,
        safety_snapshot: safety && existsSync(safety) ? safety : null
      };
    } finally {
      rmSync(incoming, { force: true });
      const cleanup = materializedCleanup as (() => void) | null;
      if (cleanup) cleanup();
    }
  }
}
