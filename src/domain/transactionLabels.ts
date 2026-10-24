/** Shared identity for transaction summary groups and their merge validation. */
export function normalizeTransactionLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}]+/gu, "");
}
