import { t } from "../i18n";

export function StaticTableHeader({
  label,
  className = ""
}: {
  label: string;
  className?: string;
}) {
  return (
    <th scope="col" className={className}>
      <button
        type="button"
        className="asset-track-sort asset-track-sort-static"
        aria-label={label}
        aria-disabled="true"
        tabIndex={-1}
      >
        {label}
      </button>
    </th>
  );
}

export function ActionTableHeader({ className = "" }: { className?: string }) {
  return <StaticTableHeader
    label={t("操作", "Actions")}
    className={`asset-track-actions-heading ${className}`.trim()}
  />;
}
