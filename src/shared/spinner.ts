type SpinnerHandle = {
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  stop: () => void;
};

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

export const startSpinner = async (
  text: string
): Promise<{ succeed: (text?: string) => void; fail: (text?: string) => void } | null> => {
  if (!process.stdout.isTTY) {
    return null;
  }
  if (process.env.SITECOREAI_QUIET === "1" || process.env.SITECOREAI_JSON === "1") {
    return null;
  }
  const { default: ora } = await import("ora");
  const spinner = ora({ text }).start();
  const handle: SpinnerHandle = {
    succeed: (message?: string) => {
      spinner.succeed(message);
      activeSpinners.delete(handle);
    },
    fail: (message?: string) => {
      spinner.fail(message);
      activeSpinners.delete(handle);
    },
    stop: () => {
      spinner.stop();
      activeSpinners.delete(handle);
    },
  };
  activeSpinners.add(handle);
  installHandlers();
  return {
    succeed: handle.succeed,
    fail: handle.fail,
  };
};
