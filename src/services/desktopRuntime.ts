type SqliteModule = typeof import("node:sqlite");

export interface DesktopOpenDialogOptions {
  title: string;
  buttonLabel?: string;
  defaultPath?: string;
  properties: string[];
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface DesktopOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DesktopElectronModule {
  shell: {
    showItemInFolder(path: string): void;
  };
  remote?: {
    dialog?: {
      showOpenDialog(
        options: DesktopOpenDialogOptions
      ): Promise<DesktopOpenDialogResult>;
    };
  };
}

export function loadSqliteModule(): SqliteModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime detection keeps unsupported installers loadable.
  return require("node:sqlite") as SqliteModule;
}

export function loadElectronModule(): DesktopElectronModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is supplied by the desktop-only Obsidian host.
  return require("electron") as DesktopElectronModule;
}
