import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssetTrackRepository } from "../database/AssetTrackRepository";
import { DatabaseManager } from "../database/DatabaseManager";
import { CURRENT_SCHEMA_VERSION } from "../database/schema";
import { inspectCsv, previewCsv } from "../domain/csv";
import {
  previewTransactionOperation as buildTransactionOperationPreview,
  validateTransactionOperationRequest
} from "../domain/transactionOperations";
import type {
  AccountDefinition,
  CategoryDefinition,
  MonthCreationPolicy
} from "../types/configuration";
import type {
  AnnualOverview
} from "../types/analysis";
import type {
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult,
  CounterpartyRenamePreview,
  CounterpartyRenameRequest,
  CounterpartyRenameResult,
  ProductHistoryQuery,
  ProductHistoryResult,
  ProductHistoryIndexResult
} from "../types/history";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection
} from "../types/csv";
import type {
  CurrentAsset,
  FixedAsset,
  MonthSectionSaveRequest,
  MonthWorkspace
} from "../types/month";
import type {
  Transaction
} from "../types/transactions";
import type {
  TransactionOperationPreviewRequest,
  OperationAuditContext,
  OperationPreview
} from "../types/operations";
import type {
  RuleCandidate,
  RuleWorkspaceShell,
  RuleImpactPreview,
  RuleWorkspaceAnalytics
} from "../types/rules";
import { BackupService } from "./BackupService";
import type { AssetTrackService } from "./AssetTrackService";
import { AssetTrackError } from "../application/errors";

export class LocalAssetTrackService implements AssetTrackService {
  private readonly repository: AssetTrackRepository;
  private readonly backups: BackupService;

  constructor(
    private readonly manager: DatabaseManager,
    private readonly workspaceRoot: string,
    private readonly pluginVersion: string,
    options: {
      reconciliationTolerance: number;
      largeExpenseThreshold: number;
    } = { reconciliationTolerance: 100, largeExpenseThreshold: 1000 }
  ) {
    this.repository = new AssetTrackRepository(manager, options);
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
      schema_version: CURRENT_SCHEMA_VERSION,
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
      debt_revision?: number;
      debts?: MonthWorkspace["debts"];
      operation_logs: Array<{
        preview: OperationPreview;
        selection: string[];
      }>;
    }
  ): Promise<MonthWorkspace> {
    this.ready();
    return this.repository.saveMonth(
      month,
      payload.expected_revision,
      payload.cash_accounts,
      payload.investment_accounts,
      payload.transactions,
      payload.fixed_assets,
      payload.debt_revision === undefined || payload.debts === undefined
        ? undefined
        : {
            expected_revision: payload.debt_revision,
            rows: payload.debts
          },
      payload.operation_logs
    );
  }

  async saveMonthSection(
    month: string,
    payload: MonthSectionSaveRequest
  ): Promise<MonthWorkspace> {
    this.ready();
    return this.repository.saveMonthSection(month, payload);
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
  ): Promise<{
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  }> {
    this.ready();
    return this.repository.rulesPreview(month, rows);
  }

  async previewTransactionOperation(
    request: TransactionOperationPreviewRequest
  ): Promise<{ preview: OperationPreview; rows: Transaction[] }> {
    this.ready();
    const requestIssues = validateTransactionOperationRequest(request.rows, request);
    if (requestIssues.length) {
      const issue = requestIssues[0];
      throw new AssetTrackError({
        code: issue.code,
        status: 422,
        params: issue.params
      });
    }
    const currentRules = this.repository.rules();
    if (request.rules_revision !== undefined && request.rules_revision !== currentRules.revision) {
      throw new AssetTrackError({
        code: "rules.revision_conflict",
        status: 409,
        params: {
          expected_rules_revision: request.rules_revision,
          actual_rules_revision: currentRules.revision
        }
      });
    }
    const ruleRows = request.rules ?? currentRules.rows;
    if (request.operation_type === "bulk-edit-category") {
      const targetKey = request.target_category_key?.trim() ?? "";
      const category = this.repository.categories().rows.find((row) => row.category_key === targetKey);
      const targetValue = request.target_value?.trim() ?? "";
      const selected = request.rows.filter((row, index) => {
        const id = typeof row.id === "number" ? row.id : null;
        return (id !== null && request.transaction_ids.includes(id))
          || (request.transaction_keys ?? []).includes(
            row.id !== undefined ? `id:${row.id}` : `client:${row.client_id ?? `row-${index}`}`
          );
      });
      if (!targetKey && !targetValue) {
        return buildTransactionOperationPreview(
          request.rows,
          request,
          ruleRows as import("../domain/rules").RuleRow[]
        );
      }
      if (!category || !category.is_active) {
        throw new AssetTrackError({
          code: "transaction.category.invalid_target",
          status: 422,
        });
      }
      if (selected.some((row) => (row.type === "代付" ? "支出" : row.type) !== category.transaction_type)) {
        throw new AssetTrackError({
          code: "transaction.category.mismatched_target",
          status: 422,
        });
      }
    }
    return buildTransactionOperationPreview(
      request.rows,
      request,
      ruleRows as import("../domain/rules").RuleRow[]
    );
  }

  async inspectCsv(
    month: string,
    filename: string,
    content: ArrayBuffer
  ): Promise<CsvInspection> {
    return inspectCsv(month, filename, Buffer.from(content));
  }

  async previewMappedCsv(
    month: string,
    filename: string,
    content: ArrayBuffer,
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview> {
    this.ready();
    const preview = previewCsv(
      month,
      filename,
      Buffer.from(content),
      mapping
    );
    const categories = this.repository.categories().rows;
    const byName = new Map(categories.map((category) => [category.name, category]));
    preview.rows = preview.rows.map((row) => {
      const definition = byName.get(row.category);
      if (["加仓", "提现"].includes(row.type)) {
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
    rows: RuleCandidate[];
  }> {
    this.ready();
    return this.repository.ruleCandidates(month, rows, minOccurrences);
  }

  async ruleWorkspaceShell(): Promise<RuleWorkspaceShell> {
    this.ready();
    return this.repository.ruleWorkspaceShell();
  }

  async ruleImpactPreview(rule: import("../domain/rules").RuleRow): Promise<RuleImpactPreview> {
    this.ready();
    return this.repository.ruleImpactPreview(rule);
  }

  async ruleWorkspaceAnalytics(
    minOccurrences = 2
  ): Promise<RuleWorkspaceAnalytics> {
    this.ready();
    return this.repository.ruleWorkspaceAnalytics(minOccurrences);
  }

  async productOverview(query: ProductHistoryQuery = {}): Promise<ProductHistoryIndexResult> {
    this.ready();
    return this.repository.productOverview(query);
  }

  async productHistoryIndex(
    query: ProductHistoryQuery
  ): Promise<ProductHistoryIndexResult> {
    this.ready();
    return this.repository.productHistoryIndex(query);
  }

  async productHistory(query: ProductHistoryQuery): Promise<ProductHistoryResult> {
    this.ready();
    return this.repository.productHistory(query);
  }

  async previewCategoryBackfill(
    request: Omit<CategoryBackfillRequest, "expected_month_revisions">
  ): Promise<CategoryBackfillPreview> {
    this.ready();
    return this.repository.previewCategoryBackfill(request);
  }

  async applyCategoryBackfill(
    request: CategoryBackfillRequest
  ): Promise<CategoryBackfillResult> {
    this.ready();
    return this.repository.applyCategoryBackfill(request);
  }

  async previewProductRename(
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): Promise<ProductRenamePreview> {
    this.ready();
    return this.repository.previewProductRename(request);
  }

  async applyProductRename(request: ProductRenameRequest): Promise<ProductRenameResult> {
    this.ready();
    return this.repository.applyProductRename(request);
  }

  async previewCounterpartyRename(
    request: Omit<CounterpartyRenameRequest, "expected_month_revisions">
  ): Promise<CounterpartyRenamePreview> {
    this.ready();
    return this.repository.previewCounterpartyRename(request);
  }

  async applyCounterpartyRename(request: CounterpartyRenameRequest): Promise<CounterpartyRenameResult> {
    this.ready();
    return this.repository.applyCounterpartyRename(request);
  }

  async debts(): Promise<{ revision: number; rows: MonthWorkspace["debts"] }> {
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
    rows: Array<Record<string, unknown>>,
    audit?: OperationAuditContext
  ): Promise<unknown> {
    this.ready();
    return this.repository.saveRules(revision, rows, audit);
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
    rows: CategoryDefinition[],
    audit?: OperationAuditContext
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    this.ready();
    return this.repository.saveCategories(revision, rows, audit);
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
      throw new AssetTrackError({
        code: "backup.directory_required",
        status: 422
      });
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
        schema: status?.schema_version ?? CURRENT_SCHEMA_VERSION,
        database: this.manager.getPath()
      }))
      .digest("hex")
      .slice(0, 16);
  }
}
