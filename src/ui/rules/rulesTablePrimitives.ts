export function focusNewTableRow(
  container: HTMLDivElement | null,
  rowKey: string | null
): boolean {
  if (!container || !rowKey) return false;
  const row = Array.from(
    container.querySelectorAll("[data-asset-track-row-key]")
  ).find((element) => element.getAttribute("data-asset-track-row-key") === rowKey);
  if (!row) return false;
  row.scrollIntoView({ block: "nearest" });
  const input = row.querySelector("input:not(:disabled), select:not(:disabled)");
  if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
    input.focus();
  }
  return true;
}
