import { DATABASE_NAME } from "../constants";

export function normalizeDataDirectory(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Asset-track 数据目录不能包含 . 或 ..");
  }
  return normalized;
}

export function databaseVaultPath(dataDirectory: string): string {
  const normalized = normalizeDataDirectory(dataDirectory);
  if (!normalized) throw new Error("尚未选择 Asset-track 数据目录");
  return `${normalized}/${DATABASE_NAME}`;
}

export function backupsVaultPath(dataDirectory: string): string {
  const normalized = normalizeDataDirectory(dataDirectory);
  if (!normalized) throw new Error("尚未选择 Asset-track 数据目录");
  return `${normalized}/backups`;
}

/** @deprecated Use normalizeDataDirectory. */
export const normalizeWorkspacePath = normalizeDataDirectory;
