import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssetTrackRepository } from "../database/AssetTrackRepository";
import { DatabaseManager } from "../database/DatabaseManager";
import { inspectCsv, previewCsv } from "../domain/csv";
import type {
  AccountDefinition,
  AnnualOverview,
  CategoryDefinition,
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  CurrentAsset,
  FixedAsset,
  MonthCreationPolicy,
  MonthWorkspace,
  Transaction
} from "../types";
import { BackupService } from "./BackupService";
import {
  AssetTrackError,
  type AssetTrackService
} from "./AssetTrackService";

export class LocalAssetTrackService implements AssetTrackService {
  private readonly repository: AssetTrackRepository;
  private readonly backups: BackupService;

  constructor(
    private readonly manager: DatabaseManager,
    private readonly workspaceRoot: string,
    private readonly pluginVersion: string
  ) {
    this.repository = new AssetTrackRepository(manager);
    this.backups = new BackupService(manager, pluginVersion);
  }

  private ready(): void {
    this.repository.initialize();
  }

  async meta(): Promise<Record<string, unknown>> {
    this.ready();
    return {
      app_name: "Asset Track",
      app_version: this.pluginVersion,
      protocol_version: "typescript-local-1",
      schema_version: 9,
      source_revision: this.sourceRevision()
    };
  }

  async months(): Promise<MonthCreationPolicy> {
    this.ready();
    return this.repository.monthCreationPolicy();
  }

  async month(month: string): Promise<MonthWorkspace> {
    this.ready();
    return this.repository.getMonth(month);
  }

  async currentAsset(): Promise<CurrentAsset> {
    this.ready();
    return this.repository.currentAsset();
  }

  async annual(year: string): Promise<AnnualOverview> {
    this.ready();
    return this.repository.annual(year);
  }

  async createMonth(month: string): Promise<MonthWorkspace> {
    this.ready();
    return this.repository.createMonth(month);
  }

  async deleteMonth(
    month: string,
    revision: number
  ): Promise<Record<string, unknown>> {
    this.ready();
    return this.repository.deleteMonth(month, revision);
  }

  async saveMonth(
    month: string,
    payload: {
      expected_revision: number;
      cash_accounts: MonthWorkspace["cash_accounts"];
      investment_accounts: MonthWorkspace["investment_accounts"];
      transactions: Transaction[];
      fixed_assets: FixedAsset[];
    }
  ): Promise<MonthWorkspace> {
    this.ready();
    return this.repository.saveMonth(
      month,
      payload.expected_revision,
      payload.cash_accounts,
      payload.investment_accounts,
      payload.transactions,
      payload.fixed_assets
    );
  }

  async validateTransactions(
    month: string,
    rows: Transaction[]
  ): Promise<{ issues: Array<Record<string, unknown>> }> {
    this.ready();
    return { issues: this.repository.validateTransactionRows(month, rows) };
  }

  async applyRules(
    month: string,
    rows: Transaction[]
  ): Promise<{ base_revision: number; proposed_rows: Transaction[] }> {
    this.ready();
    return this.repository.rulesPreview(month, rows);
  }

  async inspectCsv(
    month: string,
    filename: string,
    contentBase64: string
  ): Promise<CsvInspection> {
    return inspectCsv(month, filename, Buffer.from(contentBase64, "base64"));
  }

  async previewMappedCsv(
    month: string,
    filename: string,
    contentBase64: string,
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview> {
    this.ready();
    const preview = previewCsv(
      month,
      filename,
      Buffer.from(contentBase64, "base64"),
      mapping
    );
    const categories = this.repository.categories().rows;
    const byName = new Map(categories.map((category) => [category.name, category]));
    preview.rows = preview.rows.map((row) => {
      const definition = byName.get(row.category);
      if (["代付", "加仓", "提现"].includes(row.type)) {
        return { ...row, category: "", category_key: null };
      }
      return { ...row, category_key: definition?.category_key ?? null };
    });
    preview.issues = this.repository.validateTransactionRows(month, preview.rows);
    return preview;
  }

  async ruleCandidates(
    month: string,
    rows: Transaction[],
    minOccurrences = 2
  ): Promise<{
    month: string;
    rules_revision: number;
    min_occurrences: number;
    rows: import("../types").RuleCandidate[];
  }> {
    this.ready();
    return this.repository.ruleCandidates(month, rows, minOccurrences);
  }

  async debts(): Promise<{
    revision: number;
    rows: Array<Record<string, unknown>>;
  }> {
    this.ready();
    return this.repository.debts();
  }

  async saveDebts(
    revision: number,
    rows: Array<Record<string, unknown>>
  ): Promise<unknown> {
    this.ready();
    return this.repository.saveDebts(revision, rows);
  }

  async rules(): Promise<{
    revision: number;
    rows: Array<Record<string, unknown>>;
  }> {
    this.ready();
    return this.repository.rules();
  }

  async saveRules(
    revision: number,
    rows: Array<Record<string, unknown>>
  ): Promise<unknown> {
    this.ready();
    return this.repository.saveRules(revision, rows);
  }

  async categories(): Promise<{
    revision: number;
    rows: CategoryDefinition[];
  }> {
    this.ready();
    return this.repository.categories();
  }

  async saveCategories(
    revision: number,
    rows: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    this.ready();
    return this.repository.saveCategories(revision, rows);
  }

  async accounts(): Promise<{
    revision: number;
    rows: AccountDefinition[];
  }> {
    this.ready();
    return this.repository.accounts();
  }

  async saveAccounts(
    revision: number,
    rows: AccountDefinition[]
  ): Promise<{ revision: number; rows: AccountDefinition[] }> {
    this.ready();
    return this.repository.saveAccounts(revision, rows);
  }

  async backup(directory?: string): Promise<{
    path: string;
    validation: Record<string, unknown>;
  }> {
    this.ready();
    if (!directory) {
      throw new AssetTrackError("请选择备份导出目录", 422);
    }
    const result = await this.backups.exportZip(directory);
    return {
      path: result.path,
      validation: result.validation as unknown as Record<string, unknown>
    };
  }

  async validateBackup(path: string): Promise<Record<string, unknown>> {
    return this.backups.validate(path) as unknown as Record<string, unknown>;
  }

  async restoreBackup(path: string): Promise<Record<string, unknown>> {
    const result = await this.backups.restore(path);
    this.ready();
    return result;
  }

  async runtimeStatus(): Promise<Record<string, unknown>> {
    this.ready();
    const validation = this.manager.validate(false);
    return {
      state: "ready",
      runtime: "typescript",
      node_version: process.versions.node,
      electron_version: process.versions.electron ?? null,
      db_path: this.manager.getPath(),
      workspace_path: this.workspaceRoot,
      schema_version: validation.schema_version,
      journal_mode: "wal",
      connection_open: this.manager.isOpen
    };
  }

  async exportDiagnostics(): Promise<{
    path: string;
    payload: Record<string, unknown>;
  }> {
    this.ready();
    const payload = {
      generated_at: new Date().toISOString(),
      plugin_version: this.pluginVersion,
      source_revision: this.sourceRevision(),
      runtime: await this.runtimeStatus(),
      schema: this.manager.validate(true)
    };
    const directory = join(this.workspaceRoot, "logs");
    mkdirSync(directory, { recursive: true });
    const path = join(
      directory,
      `asset-track-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
    return { path, payload };
  }

  async reopen(): Promise<void> {
    await this.manager.reopen();
  }

  async close(): Promise<void> {
    await this.manager.drain();
    this.manager.close();
  }

  private sourceRevision(): string {
    const status = this.manager.isOpen ? this.manager.validate(false) : null;
    return createHash("sha256")
      .update(JSON.stringify({
        schema: status?.schema_version ?? 9,
        database: this.manager.getPath()
      }))
      .digest("hex")
      .slice(0, 16);
  }
}
