import { DEFAULT_DB_RELATIVE_PATH } from "../constants";

export function normalizeWorkspacePath(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Asset_Track 根目录不能包含 . 或 ..");
  }
  return normalized;
}

export function databaseVaultPath(workspacePath: string): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) throw new Error("尚未选择 Asset_Track 根目录");
  return `${normalized}/${DEFAULT_DB_RELATIVE_PATH}`;
}
