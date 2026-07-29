import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "build",
    "dist",
    "package.json",
    "package-lock.json",
    "scripts/*.mjs",
    "esbuild.config.mjs",
    "versions.json"
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mts", "manifest.json"]
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"]
      }
    }
  },
  ...obsidianmd.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "no-alert": "warn",
      "no-undef": "off",
      "obsidianmd/settings-tab/no-manual-html-headings": "warn"
    }
  },
  {
    files: ["src/settings.ts"],
    rules: {
      // Obsidian <1.13 requires imperative display(); keep the fallback while
      // exposing an empty definition list for newer settings search.
      "@typescript-eslint/no-deprecated": "off"
    }
  }
);
