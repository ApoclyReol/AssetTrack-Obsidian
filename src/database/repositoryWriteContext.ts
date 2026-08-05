import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  CategoryDefinition,
  DebtRecord
} from "../types";
import type { RuleHistoryReadModel } from "./ruleHistoryReadModel";
import type { Row } from "./repositoryPrimitives";

export interface RepositoryWriteContext {
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
  categories(db: DatabaseSync): { revision: number; rows: CategoryDefinition[] };
  accounts(db: DatabaseSync): { revision: number; rows: AccountDefinition[] };
  debts(db: DatabaseSync): { revision: number; rows: DebtRecord[] };
  monthDebts(db: DatabaseSync, month: string): {
    revision: number;
    rows: DebtRecord[];
  };
  rules(db: DatabaseSync): { revision: number; rows: Row[] };
  ruleHistory: RuleHistoryReadModel;
}
