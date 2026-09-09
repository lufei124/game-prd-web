import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Fault } from "./db.ts";

const execute = promisify(execFile);
let picking = false;

// Static commands only: paths and request data never become executable code.
export async function pickFolder(): Promise<string | null> {
  if (picking) throw new Fault(409, "文件夹选择器已打开");
  picking = true;
  try {
    let command: string;
    let args: string[];
    if (process.platform === "darwin") {
      command = "/usr/bin/osascript";
      args = [
        "-e",
        'try\nactivate\nreturn POSIX path of (choose folder with prompt "选择要关联的资料文件夹")\non error number -128\nreturn ""\nend try',
      ];
    } else if (process.platform === "win32") {
      command = "powershell.exe";
      args = [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; if ($picker.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $picker.SelectedPath }; $picker.Dispose()",
      ];
    } else if (process.platform === "linux") {
      command = "zenity";
      args = [
        "--file-selection",
        "--directory",
        "--title=选择要关联的资料文件夹",
      ];
    } else {
      throw new Fault(400, "当前系统不支持文件夹选择器");
    }
    try {
      const { stdout } = await execute(command, args, {
        timeout: 120_000,
        maxBuffer: 32_768,
        encoding: "utf8",
      });
      return stdout.trim() || null;
    } catch (error: any) {
      if (process.platform === "linux" && error.code === 1) return null;
      throw new Fault(
        503,
        "无法打开系统文件夹选择器，请确认本机桌面可用后重试（Linux 需要 zenity）",
      );
    }
  } finally {
    picking = false;
  }
}
