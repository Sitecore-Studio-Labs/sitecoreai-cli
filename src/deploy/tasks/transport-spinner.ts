/**
 * CLI spinner + trace presentation for the Deploy API transport.
 *
 * `deployRequest` (public `./deploy` surface) reports request lifecycle
 * to an optional listener and stays silent on its own. The CLI installs
 * this listener at startup: an `ora` spinner per request plus
 * `SITECOREAI_TRACE_HTTP` trace lines, with SIGINT / SIGTERM / exit
 * cleanup so a cancelled run never leaves a spinner spinning.
 *
 * `ora` is dynamically imported on first use, so it never enters the
 * dependency graph of an SDK consumer that imports `./deploy` directly.
 */
import { consola } from "consola";
import {
  setDeployTransportListener,
  type DeployRequestSpan,
} from "@/deploy/api/common/transport-events";

type SpinnerHandle = { succeed: () => void; fail: () => void; stop: () => void };

const activeSpinners = new Set<SpinnerHandle>();
let handlersInstalled = false;

const installHandlers = (): void => {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  const cleanup = () => {
    for (const spinner of activeSpinners) {
      try {
        spinner.stop();
      } catch {
        // ignore spinner cleanup failures
      }
    }
    activeSpinners.clear();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);
};

const startSpinner = async (
  method: string,
  path: string,
  silent: boolean
): Promise<DeployRequestSpan | null> => {
  if (silent) {
    return null;
  }
  if (!process.stdout.isTTY) {
    return null;
  }
  if (process.env.SITECOREAI_QUIET === "1" || process.env.SITECOREAI_JSON === "1") {
    return null;
  }
  const { default: ora } = await import("ora");
  const spinner = ora({ text: `${method} ${path}` }).start();
  const handle: SpinnerHandle = {
    succeed: () => {
      spinner.succeed();
      activeSpinners.delete(handle);
    },
    fail: () => {
      spinner.fail();
      activeSpinners.delete(handle);
    },
    stop: () => {
      spinner.stop();
      activeSpinners.delete(handle);
    },
  };
  activeSpinners.add(handle);
  installHandlers();
  return { succeed: handle.succeed, fail: handle.fail };
};

let installed = false;

/**
 * Install the CLI spinner + HTTP-trace listener on the Deploy
 * transport. Idempotent — safe to call once per CLI invocation.
 */
export const installDeployTransportSpinner = (): void => {
  if (installed) {
    return;
  }
  installed = true;
  setDeployTransportListener({
    onRequestStart: (method, path, silent) => startSpinner(method, path, silent),
    onTrace: (message) => consola.debug(message),
  });
};
