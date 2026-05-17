/**
 * Recipe transpile step — runs in the trusted parent process.
 *
 * esbuild compiles and bundles a `.recipe.ts` into a single self-contained
 * CommonJS string. Transpiling is **not** executing — esbuild reads and
 * rewrites the source, it never runs the recipe. The bundle is then handed
 * to the confined child (`./recipe-runner.cjs`), which runs it as plain JS
 * with no TypeScript toolchain — which is what lets the child run under
 * Node's permission model (no worker threads needed). See
 * docs/recipe-sandbox.md.
 */

import { build } from "esbuild";
import { createScaiError } from "@/shared/errors";

/**
 * Transpile + bundle a `.recipe.ts` into one CommonJS string. Node built-in
 * modules stay external; everything else is inlined, so the child needs to
 * read only the single bundle file at runtime.
 */
export const transpileRecipe = async (recipePath: string): Promise<string> => {
  const nodeMajor = process.versions.node.split(".")[0];
  let outputText: string | undefined;
  try {
    const result = await build({
      entryPoints: [recipePath],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: `node${nodeMajor}`,
      sourcemap: "inline",
      logLevel: "silent",
      write: false,
    });
    outputText = result.outputFiles?.[0]?.text;
  } catch (error) {
    throw createScaiError(
      `Failed to compile recipe '${recipePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      "INPUT_INVALID",
      { hint: "Confirm the file compiles standalone (try `pnpm exec tsx <file>`)." }
    );
  }
  if (!outputText) {
    throw createScaiError(`Recipe '${recipePath}' produced no compiled output.`, "INPUT_INVALID");
  }
  return outputText;
};
