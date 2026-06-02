import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai webhook list` command wiring. Covers --root + --event-type +
 * --enabled-only threading and the inline --event-type guard (item |
 * publish | workflow accept; anything else throws).
 */

const taskMocks = vi.hoisted(() => ({
  runWebhookList: vi.fn(),
}));

vi.mock("../../../../src/webhooks/tasks/list", () => taskMocks);

import { createWebhookListCommand } from "../../../../src/commands/webhook/list";

const runCmd = async (args: string[]): Promise<void> => {
  const command = createWebhookListCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runWebhookList.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookListCommand", () => {
  it("delegates to runWebhookList with no filters when bare", async () => {
    await runCmd(["--quiet"]);
    expect(taskMocks.runWebhookList).toHaveBeenCalledOnce();
    const call = taskMocks.runWebhookList.mock.calls[0][0];
    expect(call.root).toBeUndefined();
    expect(call.eventType).toBeUndefined();
    expect(call.enabledOnly).toBeUndefined();
  });

  it("threads --root through verbatim", async () => {
    await runCmd(["--quiet", "--root", "/sitecore/system/Webhooks/Workflow"]);
    expect(taskMocks.runWebhookList).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/system/Webhooks/Workflow" })
    );
  });

  it("threads --event-type item / publish / workflow through", async () => {
    for (const value of ["item", "publish", "workflow"]) {
      taskMocks.runWebhookList.mockClear();
      await runCmd(["--quiet", "--event-type", value]);
      expect(taskMocks.runWebhookList).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: value })
      );
    }
  });

  it("rejects an unrecognised --event-type", async () => {
    await expect(runCmd(["--quiet", "--event-type", "garbage"])).rejects.toThrow(
      /Invalid --event-type 'garbage'/
    );
    expect(taskMocks.runWebhookList).not.toHaveBeenCalled();
  });

  it("threads --enabled-only as a boolean", async () => {
    await runCmd(["--quiet", "--enabled-only"]);
    expect(taskMocks.runWebhookList).toHaveBeenCalledWith(
      expect.objectContaining({ enabledOnly: true })
    );
  });
});
