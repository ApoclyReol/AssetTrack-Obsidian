import {
  loadElectronModule,
  type DesktopOpenDialogOptions
} from "./desktopRuntime";
import { t } from "../i18n";

const electron = loadElectronModule();

async function choose(
  options: DesktopOpenDialogOptions
): Promise<string | null> {
  const dialog = electron.remote?.dialog;
  if (!dialog) {
    throw new Error(t(
      "当前 Obsidian 桌面运行时无法打开系统文件选择器",
      "The current desktop runtime cannot open the system file picker."
    ));
  }
  const result = await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0] ?? null;
}

export function chooseBackupDirectory(
  defaultPath?: string
): Promise<string | null> {
  return choose({
    title: t("选择 Asset Track 备份导出目录", "Choose an Asset Track backup destination"),
    buttonLabel: t("导出到这里", "Export here"),
    defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });
}

export function chooseBackupFile(
  defaultPath?: string
): Promise<string | null> {
  return choose({
    title: t("选择 Asset Track 备份文件", "Choose an Asset Track backup"),
    buttonLabel: t("选择并校验", "Choose and validate"),
    defaultPath,
    properties: ["openFile"],
    filters: [
      {
        name: t("Asset Track 备份", "Asset Track backups"),
        extensions: ["zip", "db", "sqlite", "sqlite3"]
      },
      { name: t("所有文件", "All files"), extensions: ["*"] }
    ]
  });
}
