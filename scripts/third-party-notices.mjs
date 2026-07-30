import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const dependencyGroups = [
  {
    label: "React / React DOM",
    packages: ["react", "react-dom"],
    project: "https://react.dev/"
  },
  {
    label: "Recharts",
    packages: ["recharts"],
    project: "https://recharts.org/"
  },
  {
    label: "SheetJS Community Edition (`xlsx`)",
    packages: ["xlsx"],
    project: "https://sheetjs.com/"
  }
];

const sameValue = (values, label) => {
  const unique = [...new Set(values)];
  if (unique.length !== 1 || unique[0] === undefined) {
    throw new Error(`${label} 不一致或缺失：${values.join(", ")}`);
  }
  return unique[0];
};

export function renderThirdPartyNotices() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const manifest = readJson("manifest.json");
  const bundleBytes = statSync(resolve(root, "dist/main.js")).size;
  const declaredNames = Object.keys(pkg.dependencies ?? {}).sort();
  const coveredNames = dependencyGroups.flatMap(({ packages }) => packages).sort();
  if (JSON.stringify(declaredNames) !== JSON.stringify(coveredNames)) {
    throw new Error(
      `生产依赖声明范围不完整：package.json=${declaredNames.join(", ")}；声明配置=${coveredNames.join(", ")}`
    );
  }
  if (
    JSON.stringify(lock.packages?.[""]?.dependencies ?? {}) !==
    JSON.stringify(pkg.dependencies ?? {})
  ) {
    throw new Error("package.json 与 package-lock.json 的生产依赖声明不一致");
  }

  const rows = dependencyGroups.map(({ label, packages, project }) => {
    const entries = packages.map((name) => {
      if (!(name in pkg.dependencies)) {
        throw new Error(`${name} 不在 package.json 的生产依赖中`);
      }
      const entry = lock.packages?.[`node_modules/${name}`];
      if (!entry) throw new Error(`package-lock.json 缺少 ${name}`);
      return entry;
    });
    const version = sameValue(entries.map((entry) => entry.version), `${label} 版本`);
    const license = sameValue(entries.map((entry) => entry.license), `${label} 许可证`);
    return `| ${label} | ${version} | ${license} | ${project} |`;
  });

  return `# Third-Party Notices

Asset Track v${manifest.version} 的生产 \`main.js\` 会打包以下直接依赖。版本和许可证
来自 \`package-lock.json\`，文件大小来自当前生产构建；此清单由
\`npm run notices:update\` 生成，并由 \`npm run release:check\` 验证。

| 依赖 | 锁定版本 | 许可证 | 项目 |
| --- | --- | --- | --- |
${rows.join("\n")}

SheetJS 使用固定 CDN tarball，\`package-lock.json\` 同时锁定下载地址、版本和
integrity。当前 SheetJS 由账单解析模块静态导入，因此随 React、Recharts 一起进入
初始 \`main.js\`，尚未延迟加载。

当前 v${manifest.version} 生产 \`dist/main.js\` 为 ${bundleBytes} bytes。

Obsidian、Electron 和开发/测试工具未打入插件的三个发布文件，分别遵循其自身许可。
`;
}

export function thirdPartyNoticesPath() {
  return resolve(root, "THIRD_PARTY_NOTICES.md");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = renderThirdPartyNotices();
  const path = thirdPartyNoticesPath();
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== output) {
      console.error("THIRD_PARTY_NOTICES.md 与 lockfile、插件版本或生产 bundle 不一致");
      console.error("请先运行 npm run build && npm run notices:update");
      process.exit(1);
    }
    console.log("第三方依赖声明与当前生产构建一致");
  } else {
    writeFileSync(path, output);
    console.log("已更新 THIRD_PARTY_NOTICES.md");
  }
}
