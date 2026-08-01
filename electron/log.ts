// 轻量日志模块：写 userData/logs/main.log，超 2MB 轮转（保留 1 份 .old）
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const MAX_LOG = 2 * 1024 * 1024;
let logDir = "";
let logPath = "";

function ensure(): void {
  if (logPath) return;
  try {
    logDir = join(app.getPath("userData"), "logs");
    mkdirSync(logDir, { recursive: true });
    logPath = join(logDir, "main.log");
  } catch { /* 日志不可用时静默 */ }
}

function rotateIfNeeded(): void {
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_LOG) {
      renameSync(logPath, logPath + ".old");
    }
  } catch { /* ignore */ }
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function log(level: "info" | "warn" | "error", msg: string): void {
  ensure();
  if (!logPath) return;
  rotateIfNeeded();
  try {
    appendFileSync(logPath, `[${ts()}] [${level}] ${msg}\n`, "utf-8");
  } catch { /* ignore */ }
}

export const logInfo = (msg: string) => log("info", msg);
export const logWarn = (msg: string) => log("warn", msg);
export const logError = (msg: string) => log("error", msg);

/** 安装全局错误捕获：未捕获异常/拒绝 → 写日志（不吞掉原始行为） */
export function installGlobalErrorLogging(): void {
  process.on("uncaughtException", (err) => {
    logError(`uncaughtException: ${err?.stack || String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    logError(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
}
