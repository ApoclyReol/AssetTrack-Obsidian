import { requestUrl } from "obsidian";
import type {
  AccountDefinition,
  AnnualOverview,
  CategoryDefinition,
  CurrentAsset,
  FixedAsset,
  MonthCreationPolicy,
  MonthWorkspace,
  Transaction
} from "../types";
import type { SidecarManager } from "./SidecarManager";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: unknown
  ) {
    super(message);
  }
}

export class AssetTrackApi {
  constructor(private readonly sidecar: SidecarManager) {}

  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown
  ): Promise<T> {
    await this.sidecar.ensureReady();
    const response = await requestUrl({
      url: this.sidecar.endpoint(path),
      method,
      headers: this.sidecar.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.json?.detail ?? response.text;
      const message =
        typeof detail === "string"
          ? detail
          : String(detail?.message ?? `API 请求失败（${response.status}）`);
      throw new ApiError(message, response.status, detail);
    }
    return response.json as T;
  }

  meta(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/meta");
  }

  months(): Promise<MonthCreationPolicy> {
    return this.request("/api/v1/months");
  }

  month(month: string): Promise<MonthWorkspace> {
    return this.request(`/api/v1/months/${month}`);
  }

  currentAsset(): Promise<CurrentAsset> {
    return this.request("/api/v1/current-asset");
  }

  annual(year: string): Promise<AnnualOverview> {
    return this.request(`/api/v1/annual/${year}`);
  }

  createMonth(month: string): Promise<MonthWorkspace> {
    return this.request(`/api/v1/months/${month}`, "POST");
  }

  deleteMonth(month: string, revision: number): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/months/${month}`, "DELETE", {
      expected_revision: revision,
      confirm_month: month
    });
  }

  saveMonth(
    month: string,
    payload: {
      expected_revision: number;
      cash_accounts: MonthWorkspace["cash_accounts"];
      investment_accounts: MonthWorkspace["investment_accounts"];
      transactions: Transaction[];
      fixed_assets: FixedAsset[];
    }
  ): Promise<MonthWorkspace> {
    return this.request(`/api/v1/months/${month}/workspace`, "PUT", payload);
  }

  validateTransactions(month: string, rows: Transaction[]): Promise<{ issues: unknown[] }> {
    return this.request(`/api/v1/months/${month}/transactions/validate`, "POST", {
      rows
    });
  }

  applyRules(
    month: string,
    rows: Transaction[]
  ): Promise<{ base_revision: number; proposed_rows: Transaction[] }> {
    return this.request(
      `/api/v1/months/${month}/transactions/rules-preview`,
      "POST",
      { rows }
    );
  }

  importCsv(
    month: string,
    filename: string,
    contentBase64: string
  ): Promise<{
    rows: Transaction[];
    issues: unknown[];
    type_summary: Record<string, number>;
    modes: Array<"append" | "replace">;
  }> {
    return this.request(
      `/api/v1/months/${month}/transactions/import-json`,
      "POST",
      { filename, content_base64: contentBase64 }
    );
  }

  debts(): Promise<{ revision: number; rows: Array<Record<string, unknown>> }> {
    return this.request("/api/v1/debts");
  }

  saveDebts(revision: number, rows: Array<Record<string, unknown>>): Promise<unknown> {
    return this.request("/api/v1/debts", "PUT", {
      expected_revision: revision,
      rows
    });
  }

  rules(): Promise<{ revision: number; rows: Array<Record<string, unknown>> }> {
    return this.request("/api/v1/rules");
  }

  saveRules(revision: number, rows: Array<Record<string, unknown>>): Promise<unknown> {
    return this.request("/api/v1/rules", "PUT", {
      expected_revision: revision,
      rows
    });
  }

  categories(): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    return this.request("/api/v1/category-definitions");
  }

  saveCategories(
    revision: number,
    rows: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    return this.request("/api/v1/category-definitions", "PUT", {
      expected_revision: revision,
      rows
    });
  }

  accounts(): Promise<{ revision: number; rows: AccountDefinition[] }> {
    return this.request("/api/v1/account-definitions");
  }

  saveAccounts(
    revision: number,
    rows: AccountDefinition[]
  ): Promise<{ revision: number; rows: AccountDefinition[] }> {
    return this.request("/api/v1/account-definitions", "PUT", {
      expected_revision: revision,
      rows
    });
  }

  backup(path?: string): Promise<{ path: string }> {
    return this.request("/api/v1/backups/export", "POST", path ? { path } : {});
  }

  validateBackup(path: string): Promise<Record<string, unknown>> {
    return this.request("/api/v1/backups/validate", "POST", { path });
  }

  restoreBackup(path: string): Promise<Record<string, unknown>> {
    return this.request("/api/v1/backups/import", "POST", { path });
  }

  runtimeStatus(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/runtime-status");
  }
}
