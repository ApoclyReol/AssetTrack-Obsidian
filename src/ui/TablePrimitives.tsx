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
      <span
        className="asset-track-sort asset-track-sort-static"
      >
        {label}
      </span>
    </th>
  );
}

export function ActionTableHeader({ className = "" }: { className?: string }) {
  return (
    <th
      scope="col"
      className={`asset-track-actions-heading ${className}`.trim()}
      aria-label={t("操作", "Actions")}
    />
  );
}
