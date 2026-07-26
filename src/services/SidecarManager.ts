import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  FileSystemAdapter,
  Notice,
  requestUrl,
  type Plugin
} from "obsidian";
import type { AssetTrackSettings, SidecarStatus } from "../types";
import { databaseVaultPath } from "./workspacePath";

declare const __ASSET_TRACK_BUNDLE_ARCH__: string;

type StatusListener = (status: SidecarStatus) => void;

export class SidecarManager {
  private child: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private bootstrapToken = "";
  private sessionToken = "";
  private status: SidecarStatus = { state: "stopped" };
  private listeners = new Set<StatusListener>();

  constructor(
    private readonly plugin: Plugin,
    private readonly getSettings: () => AssetTrackSettings
  ) {}

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SidecarStatus {
    return { ...this.status };
  }

  private publish(status: SidecarStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(this.getStatus()));
  }

  private filesystemAdapter(): FileSystemAdapter {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Asset Track V1 仅支持桌面文件系统 Vault");
    }
    return adapter;
  }

  private databasePath(): string {
    return this.filesystemAdapter().getFullPath(
      databaseVaultPath(this.getSettings().workspacePath)
    );
  }

  private workspacePath(): string {
    return this.filesystemAdapter().getFullPath(
      this.getSettings().workspacePath
    );
  }

  private executablePath(): string {
    const pluginDir = this.plugin.manifest.dir;
    if (!pluginDir) throw new Error("无法确定插件目录");
    return this.filesystemAdapter().getFullPath(
      join(pluginDir, "sidecar", "AssetTrackSidecar")
    );
  }

  async ensureReady(): Promise<void> {
    if (this.status.state === "ready") return;
    if (this.startPromise) return this.startPromise;
    const notice = new Notice("正在启动 Asset Track sidecar，首次启动可能需要一些时间…", 0);
    this.startPromise = this.start();
    try {
      await this.startPromise;
      new Notice("Asset Track sidecar 已就绪");
    } finally {
      notice.hide();
      this.startPromise = null;
    }
  }

  private async start(): Promise<void> {
    if (process.platform !== "darwin") {
      throw new Error("Asset Track 当前安装包仅支持 macOS 桌面版 Obsidian");
    }
    if (process.arch !== __ASSET_TRACK_BUNDLE_ARCH__) {
      throw new Error(
        `sidecar 架构不匹配：安装包为 ${__ASSET_TRACK_BUNDLE_ARCH__}，`
        + `当前 Obsidian 为 ${process.arch}。请安装匹配架构的完整插件目录。`
      );
    }
    const executable = this.executablePath();
    this.bootstrapToken = randomBytes(32).toString("base64url");
    this.sessionToken = "";
    this.publish({ state: "starting" });
    await new Promise<void>((resolveReady, rejectReady) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) rejectReady(new Error("sidecar ready 握手超时（60 秒）"));
      }, 60_000);
      const child = spawn(executable, [], {
        cwd: dirname(executable),
        env: {
          ...process.env,
          ASSET_TRACK_BOOTSTRAP_TOKEN: this.bootstrapToken,
          ASSET_TRACK_PARENT_PID: String(process.pid),
          ASSET_TRACK_DB_PATH: this.databasePath(),
          ASSET_TRACK_DATA_DIR: this.workspacePath(),
          ASSET_TRACK_APP_VERSION: "3.2.0"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;
      child.stderr!.on("data", (chunk) => {
        console.debug("[Asset Track sidecar]", String(chunk).trim());
      });
      createInterface({ input: child.stdout! }).on("line", async (line) => {
        try {
          const event = JSON.parse(line) as {
            event?: string;
            port?: number;
            pid?: number;
          };
          if (event.event !== "ready" || !event.port) return;
          const session = await requestUrl({
            url: `http://127.0.0.1:${event.port}/api/v1/session`,
            method: "POST",
            headers: { "X-AssetTrack-Bootstrap": this.bootstrapToken },
            throw: false
          });
          if (session.status !== 200) throw new Error("session 握手失败");
          this.sessionToken = String(session.json.session);
          settled = true;
          clearTimeout(timeout);
          this.publish({ state: "ready", port: event.port, pid: event.pid });
          resolveReady();
        } catch (error) {
          if (!settled) rejectReady(error);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (!settled) rejectReady(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        this.child = null;
        const message = `sidecar 已退出（code=${code ?? "—"}, signal=${signal ?? "—"}）`;
        this.publish({ state: "failed", error: message });
        if (!settled) rejectReady(new Error(message));
        else new Notice(`${message}，可运行“重启 sidecar”。`);
      });
    }).catch((error) => {
      this.child?.kill("SIGTERM");
      this.child = null;
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ state: "failed", error: message });
      throw error;
    });
  }

  endpoint(path: string): string {
    if (this.status.state !== "ready" || !this.status.port) {
      throw new Error("sidecar 尚未准备好");
    }
    return `http://127.0.0.1:${this.status.port}${path}`;
  }

  headers(): Record<string, string> {
    if (!this.sessionToken) throw new Error("sidecar session 尚未建立");
    return {
      "Content-Type": "application/json",
      "X-AssetTrack-Session": this.sessionToken
    };
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.ensureReady();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.publish({ state: "stopped" });
      return;
    }
    if (this.status.port) {
      await requestUrl({
        url: this.endpoint("/internal/shutdown"),
        method: "POST",
        headers: { "X-AssetTrack-Bootstrap": this.bootstrapToken },
        throw: false
      }).catch(() => undefined);
    }
    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolveStop();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
    });
    this.child = null;
    this.sessionToken = "";
    this.publish({ state: "stopped" });
  }
}
