import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");
const lock = readJson("package-lock.json");
const failures = [];

if (pkg.version !== manifest.version) failures.push("package.json 与 manifest.json 版本不一致");
if (pkg.license !== "MIT") failures.push("package.json license 必须为 MIT");
if (versions[manifest.version] !== manifest.minAppVersion) {
  failures.push("versions.json 缺少当前版本或最低 Obsidian 版本不一致");
}

for (const path of ["LICENSE", "dist/main.js", "manifest.json", "styles.css"]) {
  try {
    if (statSync(resolve(root, path)).size === 0) failures.push(`${path} 为空`);
  } catch {
    failures.push(`${path} 不存在`);
  }
}

const lockedXlsx = lock.packages?.["node_modules/xlsx"];
if (!lockedXlsx?.resolved?.startsWith("https://cdn.sheetjs.com/")) {
  failures.push("SheetJS 未锁定到预期 CDN tarball");
}
if (!lockedXlsx?.integrity) failures.push("SheetJS lockfile 条目缺少 integrity");

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const bytes = statSync(resolve(root, "dist/main.js")).size;
console.log(`发布校验通过：v${manifest.version}，dist/main.js ${bytes} bytes`);
