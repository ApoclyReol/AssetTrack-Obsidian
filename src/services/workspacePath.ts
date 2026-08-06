import { DATABASE_NAME } from "../constants";
import {
  isAbsolute,
  relative,
  resolve
} from "node:path";
import { AssetTrackError } from "../application/errors";
import { displayError } from "../i18n";

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
    throw new AssetTrackError({ code: "workspace.relative_required", status: 422 });
  }
  if (trimmed.includes("\u0000")) {
    throw new AssetTrackError({ code: "workspace.invalid_character", status: 422 });
  }
  const normalized = trimmed
    .replaceAll("\\", "/")
    .replace(/\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new AssetTrackError({ code: "workspace.dot_segment", status: 422 });
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
      error: displayError(error)
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
  throw new AssetTrackError({ code: "workspace.outside_vault", status: 422 });
}

export function databaseVaultPath(dataDirectory: string): string {
  const normalized = normalizeDataDirectory(dataDirectory);
  if (!normalized) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
  return `${normalized}/${DATABASE_NAME}`;
}

export function backupsVaultPath(dataDirectory: string): string {
  const normalized = normalizeDataDirectory(dataDirectory);
  if (!normalized) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
  return `${normalized}/backups`;
}
