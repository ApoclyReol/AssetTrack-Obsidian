import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("Obsidian 1.13 settings boundary", () => {
  it("uses declarative settings without a PluginSettingTab display override", () => {
    const source = readFileSync(resolve(root, "src/settings.ts"), "utf8").replace(
      /\r\n/g,
      "\n"
    );

    expect(source).toContain("getSettingDefinitions(): SettingDefinitionItem[]");
    expect(source).toContain('control: {\n              type: "folder"');
    const tabSource = source.slice(
      source.indexOf("export class AssetTrackSettingTab"),
      source.indexOf("class AssetTrackBackupPage")
    );
    expect(tabSource).not.toContain("display(): void");
  });

  it("does not enumerate the full vault from plugin settings", () => {
    const source = readFileSync(resolve(root, "src/settings.ts"), "utf8");

    expect(source).not.toMatch(/\b(?:getAllLoadedFiles|getFiles|getMarkdownFiles)\s*\(/);
  });

  it("publishes the Obsidian 1.13 minimum version", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "manifest.json"), "utf8")
    ) as { version: string; minAppVersion: string };
    const versions = JSON.parse(
      readFileSync(resolve(root, "versions.json"), "utf8")
    ) as Record<string, string>;

    expect(manifest.version).toBe("1.4.0");
    expect(manifest.minAppVersion).toBe("1.13.0");
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });
});
