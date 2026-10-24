import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const version = process.argv[2] ?? manifest.version;
if (version !== manifest.version) throw new Error("发布说明版本必须与 manifest 一致");
const lines = readFileSync(resolve(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
const start = lines.indexOf(`## ${version}`);
if (start < 0) throw new Error(`CHANGELOG 缺少 ${version} 发布说明`);
let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
if (end < 0) end = lines.length;
const notes = lines.slice(start + 1, end).join("\n").trim();
if (!notes.startsWith("### English\n") || !notes.includes("\n### 中文\n")) {
  throw new Error("发布说明必须依次包含 English 和中文");
}
process.stdout.write(`${notes.replace(/^### (English|中文)$/gm, "## $1")}\n`);
