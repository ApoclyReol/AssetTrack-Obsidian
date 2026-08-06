import type {
  DebtRecord,
  FixedAsset
} from "../../types/month";
import { MonthDebtSection } from "../MonthDebtSection";
import { FixedAssetTable } from "../TransactionTables";

export function MonthEditorSupplementalSections({
  month,
  activeSection,
  debts,
  fixedAssets,
  onDebtsChange,
  onBlocked,
  onFixedAssetUpdate,
  onFixedAssetDelete,
  onFixedAssetAdd
}: {
  month: string;
  activeSection?: "debts" | "fixed_assets";
  debts: DebtRecord[];
  fixedAssets: FixedAsset[];
  onDebtsChange: (rows: DebtRecord[]) => void;
  onBlocked: (message: string) => void;
  onFixedAssetUpdate: (index: number, field: keyof FixedAsset, value: string) => void;
  onFixedAssetDelete: (index: number) => void;
  onFixedAssetAdd: () => void;
}) {
  const showAllSections = activeSection === undefined;
  return (
    <>
      {(showAllSections || activeSection === "debts") && <MonthDebtSection
        month={month}
        rows={debts}
        onChange={onDebtsChange}
        onBlocked={onBlocked}
        hideHeader={Boolean(activeSection)}
      />}
      {(showAllSections || activeSection === "fixed_assets") && <FixedAssetTable
        rows={fixedAssets}
        onUpdate={onFixedAssetUpdate}
        onDelete={onFixedAssetDelete}
        onAdd={onFixedAssetAdd}
        hideTitle={Boolean(activeSection)}
      />}
    </>
  );
}
