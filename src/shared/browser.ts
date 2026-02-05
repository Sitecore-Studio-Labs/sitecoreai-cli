import { spawn } from "node:child_process";

export const openBrowser = (url: string): boolean => {
  try {
    let command = "";
    let args: string[] = [];
    let shell = false;
    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
      shell = true;
    } else {
      command = "xdg-open";
      args = [url];
    }
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      shell,
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
};
