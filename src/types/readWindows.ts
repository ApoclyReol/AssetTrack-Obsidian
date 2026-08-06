export type ReadWindowKind = "analysis" | "system-check";

export interface ReadWindow {
  kind: ReadWindowKind;
  from_month: string;
  to_month: string;
  from_date: string;
  to_date: string;
  month_count: number;
}
