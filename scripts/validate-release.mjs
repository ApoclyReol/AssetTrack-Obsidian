import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderThirdPartyNotices,
  thirdPartyNoticesPath
} from "./third-party-notices.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");
const lock = readJson("package-lock.json");
const failures = [];
const manifestDescription = manifest.description.trim();
const bundlePath = "build/obsidian/asset-track/main.js";
const pluginAssetPaths = [
  bundlePath,
  "build/obsidian/asset-track/manifest.json",
  "build/obsidian/asset-track/styles.css"
];

if (pkg.version !== manifest.version) failures.push("package.json 与 manifest.json 版本不一致");
if (pkg.license !== "MIT") failures.push("package.json license 必须为 MIT");
if (versions[manifest.version] !== manifest.minAppVersion) {
  failures.push("versions.json 缺少当前版本或最低 Obsidian 版本不一致");
}
if (/\bobsidian\b/i.test(manifestDescription)) {
  failures.push("manifest.json description 不得包含 Obsidian");
}
if (!/[.!?]$/.test(manifestDescription)) {
  failures.push("manifest.json description 必须以英文标点结尾");
}
if (!/^[\x20-\x7E]+$/.test(manifestDescription)) {
  failures.push("manifest.json description 必须提供英文目录描述");
}

for (const path of ["LICENSE", ...pluginAssetPaths]) {
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

const builtManifest = readJson("build/obsidian/asset-track/manifest.json");
if (JSON.stringify(builtManifest) !== JSON.stringify(manifest)) {
  failures.push("build/obsidian/asset-track/manifest.json 与根目录 manifest.json 不一致");
}
if (
  readFileSync(resolve(root, "build/obsidian/asset-track/styles.css"), "utf8")
  !== readFileSync(resolve(root, "styles.css"), "utf8")
) {
  failures.push("build/obsidian/asset-track/styles.css 与根目录 styles.css 不一致");
}
const bundle = readFileSync(resolve(root, bundlePath), "utf8");
const forbiddenBundlePatterns = [
  [/(?:createElement|createEl)\(\s*["']script["']\s*\)/, "动态 script 元素创建"],
  [/\b(?:getFiles|getMarkdownFiles)\s*\(/, "Vault 全库枚举 API"],
  [
    /\bnavigator\s*\.\s*clipboard\b|\bclipboard\s*\.\s*(?:read|readText|write|writeText)\s*\(/i,
    "程序化剪贴板访问"
  ]
];
for (const [pattern, label] of forbiddenBundlePatterns) {
  if (pattern.test(bundle)) failures.push(`${bundlePath} 包含${label}`);
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
for (const heading of ["## Installation", "## Getting started"]) {
  if (!readme.includes(heading)) failures.push(`README.md 缺少英文 ${heading} 章节`);
}

try {
  const expectedNotices = renderThirdPartyNotices();
  const actualNotices = readFileSync(thirdPartyNoticesPath(), "utf8");
  if (actualNotices !== expectedNotices) {
    failures.push(
      "THIRD_PARTY_NOTICES.md 与 lockfile、插件版本或生产 bundle 不一致；运行 npm run notices:update"
    );
  }
} catch (error) {
  failures.push(`第三方依赖声明校验失败：${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const bytes = statSync(resolve(root, bundlePath)).size;
console.log(`发布校验通过：v${manifest.version}，${bundlePath} ${bytes} bytes`);
