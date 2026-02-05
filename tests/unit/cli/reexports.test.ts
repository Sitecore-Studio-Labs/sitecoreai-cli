import { describe, it } from "vitest";

describe("re-export modules", () => {
  it("loads api and deploy re-exports", async () => {
    await import("../../../src/deploy/api.ts");
    await import("../../../src/commands/deploy.ts");
    await import("../../../src/deploy/api/index");
    await import("../../../src/commands/deploy/index");
  });
});
