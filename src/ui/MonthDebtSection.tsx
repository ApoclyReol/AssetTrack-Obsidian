import { useEffect, useRef } from "react";
import type { DebtRecord } from "../types";
import { t } from "../i18n";
import { monthEnd } from "../domain/dates";
import { money } from "../domain/moneyFormat";
import {
  EmptyState,
  number,
  Section
} from "./editorPrimitives";
import { ActionTableHeader, StaticTableHeader } from "./TablePrimitives";

export function debtSummary(rows: DebtRecord[]): {
  openAmount: number;
  paidCount: number;
} {
  return {
    openAmount: rows
      .filter((row) => !row.is_paid)
      .reduce((total, row) => total + (Number(row.amount) || 0), 0),
    paidCount: rows.filter((row) => row.is_paid).length
  };
}

function startsInMonth(row: DebtRecord, month: string): boolean {
  return row.start_date.slice(0, 7) === month;
}

function paidAfterMonth(row: DebtRecord, month: string): boolean {
  return Boolean(row.paid_date && row.paid_date > monthEnd(month));
}

function futurePaidMessage(row: DebtRecord): string {
  return t(
    `借款未来 ${row.paid_date ?? ""} 已还清，不可修改此月借款。`,
    `This debt was already marked paid on ${row.paid_date ?? ""}; it cannot be changed from this month.`
  );
}

function createDebt(month: string): DebtRecord {
  return {
    description: "",
    counterparty: "",
    amount: 0,
    start_date: `${month}-01`,
    is_paid: false,
    paid_date: null
  };
}

export function MonthDebtSection({
  month,
  rows,
  onChange,
  onBlocked,
  hideHeader = false
}: {
  month: string;
  rows: DebtRecord[];
  onChange: (rows: DebtRecord[]) => void;
  onBlocked: (message: string) => void;
  hideHeader?: boolean;
}) {
  const { openAmount, paidCount } = debtSummary(rows);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const previousRowCount = useRef(rows.length);
  const pendingFocusKey = useRef<string | null>(null);
  useEffect(() => {
    if (rows.length > previousRowCount.current) {
      const newIndex = rows.length - 1;
      pendingFocusKey.current = String(rows[newIndex]?.id ?? `new-${newIndex}`);
      const tableScroll = tableScrollRef.current;
      if (tableScroll) tableScroll.scrollTop = tableScroll.scrollHeight;
    }
    previousRowCount.current = rows.length;
  }, [rows, month]);
  useEffect(() => {
    if (!pendingFocusKey.current) return;
    const target = Array.from(tableScrollRef.current?.querySelectorAll("[data-asset-track-row-key]") ?? [])
      .find((element) => element.getAttribute("data-asset-track-row-key") === pendingFocusKey.current);
    const input = target?.querySelector("input:not(:disabled)") as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    pendingFocusKey.current = null;
  }, [rows]);
  const update = (
    index: number,
    field: keyof Pick<DebtRecord, "description" | "counterparty" | "amount" | "is_paid">,
    value: string | boolean
  ) => {
    let blocked = "";
    let changed = false;
    const nextRows = rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const locked = paidAfterMonth(row, month);
      const editable = startsInMonth(row, month) && !locked;
      if (locked) {
        blocked = futurePaidMessage(row);
        return row;
      }
      if (field !== "is_paid" && !editable) return row;
      changed = true;
      return {
        ...row,
        [field]: field === "amount" && typeof value === "string"
          ? number(value)
          : value
      };
    });
    if (blocked) {
      onBlocked(blocked);
      return;
    }
    if (changed) onChange(nextRows);
  };
  const remove = (index: number) => {
    onChange(rows.filter((row, rowIndex) =>
      rowIndex !== index || !startsInMonth(row, month)
    ));
  };
  return (
    <Section title={hideHeader ? undefined : t("借款", "Debts")}>
      {!hideHeader && <div className="asset-track-debt-summary" role="status">
        <span>{t(`本月相关 ${rows.length} 笔`, `${rows.length} related debts`)}</span>
        <span>{t(`本月未还 ${money(openAmount)}`, `Unpaid this month ${money(openAmount)}`)}</span>
        <span>{t(`本月还清 ${paidCount} 笔`, `${paidCount} paid this month`)}</span>
      </div>}
      {rows.length === 0 ? (
        <EmptyState text={t("本月没有相关借款。", "No debts are related to this month.")} />
      ) : (
        <div ref={tableScrollRef} className="asset-track-table-scroll">
          <table className="asset-track-debt-table">
            <thead>
              <tr>
                <StaticTableHeader label={t("发生月份", "Start month")} className="asset-track-date-column" />
                <StaticTableHeader label={t("说明", "Description")} />
                <StaticTableHeader label={t("对方", "Counterparty")} />
                <StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" />
                <StaticTableHeader label={t("本月还清", "Paid this month")} className="asset-track-checkbox-heading" />
                <ActionTableHeader />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const currentMonth = startsInMonth(row, month);
                const locked = paidAfterMonth(row, month);
                const editable = currentMonth && !locked;
                const rowNumber = index + 1;
                return (
                  <tr data-asset-track-row-key={String(row.id ?? `new-${index}`)} key={row.id ?? `new-${index}`}>
                    <td className="asset-track-date-cell">{row.start_date.slice(0, 7)}</td>
                    <td>
                      <input
                        aria-label={t(`借款第 ${rowNumber} 行说明`, `Debt row ${rowNumber} description`)}
                        disabled={!editable}
                        value={row.description}
                        onChange={(event) => update(index, "description", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={t(`借款第 ${rowNumber} 行对方`, `Debt row ${rowNumber} counterparty`)}
                        disabled={!editable}
                        value={row.counterparty}
                        onChange={(event) => update(index, "counterparty", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={t(`借款第 ${rowNumber} 行金额`, `Debt row ${rowNumber} amount`)}
                        disabled={!editable}
                        type="number"
                        step="0.01"
                        value={row.amount}
                        onChange={(event) => update(index, "amount", event.target.value)}
                      />
                    </td>
                    <td className="asset-track-checkbox-cell">
                      <input
                        aria-label={t(`借款第 ${rowNumber} 行本月还清`, `Debt row ${rowNumber} paid this month`)}
                        type="checkbox"
                        checked={row.is_paid}
                        onChange={(event) => update(index, "is_paid", event.target.checked)}
                      />
                    </td>
                    <td>
                      {currentMonth ? (
                        <button
                          type="button"
                          aria-label={t(`删除借款第 ${rowNumber} 行`, `Delete debt row ${rowNumber}`)}
                          onClick={() => {
                            if (locked) onBlocked(futurePaidMessage(row));
                            else remove(index);
                          }}
                        >
                          {t("删除", "Delete")}
                        </button>
                      ) : locked ? (
                        <button type="button" onClick={() => onBlocked(futurePaidMessage(row))}>
                          {t("未来已还", "Paid later")}
                        </button>
                      ) : (
                        <span className="asset-track-muted">{t("继承", "Inherited")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={() => onChange([...rows, createDebt(month)])}>
        {t("新增借款", "Add debt")}
      </button>
    </Section>
  );
}
