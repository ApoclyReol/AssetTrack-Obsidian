import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const hasZsh = spawnSync("zsh", ["--version"], {
  encoding: "utf8"
}).status === 0;

describe("Vault installer", () => {
  it.skipIf(!hasZsh)("restores the previous plugin when the staged move fails", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-install-"));
    const vault = join(root, "vault");
    const configDirectory = [".", "obsidian"].join("");
    const target = join(vault, configDirectory, "plugins", "asset-track");
    const bundle = join(root, "bundle");
    const commands = join(root, "commands");
    mkdirSync(target, { recursive: true });
    mkdirSync(bundle, { recursive: true });
    mkdirSync(commands);
    writeFileSync(join(target, "main.js"), "old-main");
    writeFileSync(join(target, "data.json"), "{\"kept\":true}");
    writeFileSync(join(bundle, "main.js"), "new-main");
    writeFileSync(join(bundle, "manifest.json"), "{}");
    writeFileSync(join(bundle, "styles.css"), "");
    const fakeMove = join(commands, "mv");
    writeFileSync(fakeMove, `#!/bin/zsh
if [[ "$1" == *".asset-track-installing."*"/asset-track" && "$2" == *"/plugins/asset-track" ]]; then
  exit 1
fi
exec /bin/mv "$@"
`);
    chmodSync(fakeMove, 0o755);
    const result = spawnSync(
      "zsh",
      [resolve("scripts/install_to_vault.sh"), vault],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          ASSET_TRACK_BUNDLE: bundle,
          PATH: `${commands}:${process.env.PATH ?? ""}`
        }
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("已恢复原目录");
    expect(readFileSync(join(target, "main.js"), "utf8")).toBe("old-main");
    expect(readFileSync(join(target, "data.json"), "utf8")).toBe(
      "{\"kept\":true}"
    );
    rmSync(root, { recursive: true, force: true });
  });
});
