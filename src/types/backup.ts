export interface BackupManifest {
  format_version: number;
  schema_version: number;
  app_version: string;
  created_at: string;
  required_tables: string[];
  tables: Record<string, {
    rows: number;
    filename: string;
    columns: readonly string[];
    content_sha256: string;
  }>;
  files: Record<string, { size: number; sha256: string }>;
  source_revision?: string | null;
  backup_version?: number;
  integrity_check?: string;
}

export interface BackupValidation {
  valid: true;
  mode: "complete" | "sqlite";
  schema: {
    valid: true;
    integrity_check: "ok";
    missing_tables: string[];
    schema_version: number;
  };
  row_counts: Record<string, number>;
  manifest: BackupManifest | null;
  format_version: number;
  required_tables: string[];
}

export interface BackupRestoreResult {
  mode: "complete" | "sqlite";
  row_counts: Record<string, number>;
  safety_snapshot: string | null;
}
