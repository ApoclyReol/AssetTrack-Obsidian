import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const production = process.argv[2] === "production";
const outputDirectory = "build";
const reduxModulePattern = /(?:^|[\\/])node_modules[\\/]redux[\\/]dist[\\/]redux\.mjs$/;
const reduxRandomSuffixMarker = "var randomString = () => Math.random().toString(36).substring(7)";
rmSync(outputDirectory, { recursive: true, force: true });
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  mainFields: ["module", "main"],
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  ...(production
    ? { define: { "process.env.NODE_ENV": '"production"' } }
    : {}),
  outfile: `${outputDirectory}/main.js`,
  plugins: [
    {
      name: "sanitize-redux-action-suffix",
      setup(build) {
        build.onLoad({ filter: reduxModulePattern }, (args) => {
          const source = readFileSync(args.path, "utf8");
          const start = source.indexOf(reduxRandomSuffixMarker);
          const end = source.indexOf("\n", start);
          if (start < 0 || end < 0) {
            throw new Error("Unexpected Redux action-type source; refusing to alter the dependency.");
          }
          return {
            contents: `${source.slice(0, start)}${reduxRandomSuffixMarker};${source.slice(end)}`,
            loader: "js"
          };
        });
      }
    },
    {
      name: "stage-plugin-assets",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) return;
          mkdirSync(outputDirectory, { recursive: true });
          copyFileSync("manifest.json", `${outputDirectory}/manifest.json`);
          copyFileSync("styles.css", `${outputDirectory}/styles.css`);
        });
      }
    }
  ]
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
