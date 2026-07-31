// 统一 PowerShell 执行工具（EncodedCommand 方式，避免引号/换行/编码问题）
import { exec as execCb, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCb);

/** 将脚本编码为 UTF-16LE base64（抑制进度噪音，stderr 不穿透终端） */
export function encodePs(script: string): string {
  return Buffer.from("$ProgressPreference = 'SilentlyContinue';\n" + script, "utf-16le").toString("base64");
}

/** 异步执行 PowerShell，成功返回 stdout.trim()，失败返回 ""（不抛出） */
export function runPsAsync(cmd: string): Promise<string> {
  return execAsync("powershell -NoProfile -EncodedCommand " + encodePs(cmd), { timeout: 5000 })
    .then(r => r.stdout.trim())
    .catch(() => "");
}

/** 同步执行 PowerShell（仅限启动期/必须同步的场景，避免在 IPC 中阻塞主进程） */
export function psExec(cmd: string): string {
  try {
    return execSync("powershell -NoProfile -EncodedCommand " + encodePs(cmd), {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch { return ""; }
}
