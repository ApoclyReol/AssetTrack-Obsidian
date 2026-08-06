import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  CategoryDefinition
} from "../types/configuration";
import type {
  DebtRecord
} from "../types/month";
import type {
  HistoricalCategoryCount
} from "../types/rules";
import type { RuleHistoryReadModel } from "./ruleHistoryReadModel";
import type { Row } from "./repositoryPrimitives";

export interface MonthWriteDependencies {
  monthStatus(db: DatabaseSync, month: string): Row | null;
  checkMonthRevision(db: DatabaseSync, month: string, expectedRevision: number): number;
  touchMonth(
    db: DatabaseSync,
    month: string,
    revision: number,
    fixedInitialized?: number
  ): number;
  getMonths(db: DatabaseSync): string[];
  getRevision(month: string, db: DatabaseSync): number;
  categoryRows(db: DatabaseSync): CategoryDefinition[];
  debts(db: DatabaseSync): { revision: number; rows: DebtRecord[] };
  monthDebts(db: DatabaseSync, month: string): {
    revision: number;
    rows: DebtRecord[];
  };
  rules(db: DatabaseSync): { revision: number; rows: Row[] };
}

export interface ConfigurationWriteDependencies {
  categoryRows(db: DatabaseSync): CategoryDefinition[];
  categories(db: DatabaseSync): { revision: number; rows: CategoryDefinition[] };
  accounts(db: DatabaseSync): { revision: number; rows: AccountDefinition[] };
  rules(db: DatabaseSync): { revision: number; rows: Row[] };
}

export interface HistoryWriteDependencies {
  categoryRows(db: DatabaseSync): CategoryDefinition[];
  normalizedRuleRows(db: DatabaseSync): ReturnType<RuleHistoryReadModel["normalizedRuleRows"]>;
  historicalCategoryCounts(group: Row[], categories: CategoryDefinition[]): HistoricalCategoryCount[];
  getRevision(month: string, db: DatabaseSync): number;
  touchMonth(
    db: DatabaseSync,
    month: string,
    revision: number,
    fixedInitialized?: number
  ): number;
}
