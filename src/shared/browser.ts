import { spawn } from "node:child_process";

export const openBrowser = (url: string): boolean => {
  try {
    // Reject anything that isn't a well-formed http(s) URL before it
    // reaches the platform launcher. Device-flow callers only ever
    // produce https URLs; rejecting other schemes (file:, javascript:,
    // …) keeps a hostile or malformed value out of the spawn arg list.
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const safeUrl = parsed.toString();
    let command: string;
    let args: string[];
    if (process.platform === "darwin") {
      command = "open";
      args = [safeUrl];
    } else if (process.platform === "win32") {
      // rundll32 + url.dll's FileProtocolHandler opens the default
      // browser without going through cmd.exe — avoiding `cmd /c start`
      // means shell metacharacters in the URL can't chain commands.
      command = "rundll32";
      args = ["url.dll,FileProtocolHandler", safeUrl];
    } else {
      command = "xdg-open";
      args = [safeUrl];
    }
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
};
