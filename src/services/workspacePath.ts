import { DATABASE_NAME } from "../constants";
import {
  isAbsolute,
  relative,
  resolve
} from "node:path";

export interface WorkspacePathValidation {
  valid: boolean;
  normalized: string;
  error: string | null;
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:($|[\\/])/;
const UNC_PATH = /^(?:\\\\|\/\/)/;

export function normalizeDataDirectory(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("/")
    || trimmed.startsWith("\\")
    || WINDOWS_DRIVE_PATH.test(trimmed)
    || UNC_PATH.test(trimmed)
  ) {
    throw new Error("Asset-track 数据目录必须是 Vault 内的相对路径");
  }
  if (trimmed.includes("\u0000")) {
    throw new Error("Asset-track 数据目录包含无效字符");
  }
  const normalized = trimmed
    .replaceAll("\\", "/")
    .replace(/\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Asset-track 数据目录不能包含 . 或 ..");
  }
  return normalized;
}

export function validateDataDirectory(value: string): WorkspacePathValidation {
  try {
    return {
      valid: true,
      normalized: normalizeDataDirectory(value),
      error: null
    };
  } catch (error) {
    return {
      valid: false,
      normalized: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function assertPathInsideVault(
  vaultRoot: string,
  targetPath: string
): void {
  const root = resolve(vaultRoot);
  const target = resolve(targetPath);
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ""
    || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  ) {
    return;
  }
  throw new Error("Asset-track 数据路径超出当前 Vault");
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
