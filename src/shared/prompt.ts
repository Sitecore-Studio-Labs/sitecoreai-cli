import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createCliError } from "./errors";

export const assertInteractive = (message: string, hint?: string): void => {
  const nonInteractive = process.env.SITECOREAI_NON_INTERACTIVE === "1";
  if (nonInteractive || !input.isTTY || !output.isTTY) {
    const finalMessage = nonInteractive
      ? "Non-interactive mode: this command requires input. Provide flags or environment variables."
      : message;
    const finalHint =
      hint ?? "Provide required flags or environment variables for non-interactive use.";
    throw createCliError(finalMessage, "INPUT_INVALID", finalHint ? { hint: finalHint } : {});
  }
};

export const promptText = async (label: string, defaultValue?: string): Promise<string> => {
  assertInteractive(
    "Interactive prompts require a TTY.",
    "Provide values via CLI flags or environment variables."
  );
  const rl = readlinePromises.createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  rl.close();
  return answer.length > 0 ? answer : (defaultValue ?? "");
};

export const promptConfirm = async (label: string, defaultValue = false): Promise<boolean> => {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await promptText(`${label} (${hint})`)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  return ["y", "yes"].includes(answer);
};

export const promptSecret = async (label: string, allowEmpty = false): Promise<string> => {
  assertInteractive(
    "Interactive prompts require a TTY.",
    "Provide values via CLI flags or environment variables."
  );
  output.write(label);
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  let value = "";
  return await new Promise((resolve, reject) => {
    const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Prompt cancelled."));
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        output.write("\n");
        cleanup();
        if (!allowEmpty && value.length === 0) {
          const cleaned = label.trim().replace(/:$/, "");
          reject(
            createCliError(`${cleaned || "Secret"} is required.`, "INPUT_INVALID", {
              hint: "Provide a non-empty value.",
            })
          );
          return;
        }
        resolve(value);
        return;
      }
      if (key?.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write("\b \b");
        }
        return;
      }
      if (chunk) {
        value += chunk;
        output.write("*");
      }
    };

    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
    };

    input.on("keypress", onKeypress);
  });
};
