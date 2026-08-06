export type AssetTrackErrorParams = Record<string, unknown>;

export interface AssetTrackErrorOptions {
  code: string;
  status?: number;
  message?: string;
  params?: AssetTrackErrorParams;
  cause?: unknown;
}

/**
 * Structured application error shared by the domain, database and UI layers.
 * The error code is the stable protocol; message rendering belongs to i18n.
 */
export class AssetTrackError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: AssetTrackErrorParams;
  override readonly cause?: unknown;

  constructor(options: AssetTrackErrorOptions) {
    super(options.message ?? options.code);
    this.name = "AssetTrackError";
    this.status = options.status ?? 500;
    this.code = options.code;
    this.params = options.params ?? {};
    this.cause = options.cause;
  }
}
