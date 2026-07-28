type OpenDialogOptions = {
  title: string;
  buttonLabel?: string;
  defaultPath?: string;
  properties: string[];
  filters?: Array<{ name: string; extensions: string[] }>;
};

type OpenDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

const electron = require("electron") as {
  remote?: {
    dialog?: {
      showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>;
    };
  };
};

async function choose(options: OpenDialogOptions): Promise<string | null> {
  const dialog = electron.remote?.dialog;
  if (!dialog) {
    throw new Error("当前 Obsidian 桌面运行时无法打开系统文件选择器");
  }
  const result = await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0] ?? null;
}

export function chooseBackupDirectory(defaultPath?: string): Promise<string | null> {
  return choose({
    title: "选择 Asset Track 备份导出目录",
    buttonLabel: "导出到这里",
    defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });
}

export function chooseBackupFile(defaultPath?: string): Promise<string | null> {
  return choose({
    title: "选择 Asset Track 备份文件",
    buttonLabel: "选择并校验",
    defaultPath,
    properties: ["openFile"],
    filters: [
      { name: "Asset Track 备份", extensions: ["zip", "db", "sqlite", "sqlite3"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
}

export function chooseBackupSourceDirectory(
  defaultPath?: string
): Promise<string | null> {
  return choose({
    title: "选择 Asset Track 格式 2 备份目录",
    buttonLabel: "选择并校验",
    defaultPath,
    properties: ["openDirectory"]
  });
}
