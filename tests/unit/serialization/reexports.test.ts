import { describe, it } from "vitest";

describe("serialization re-exports", () => {
  it("loads serialization task and api re-exports", async () => {
    await import("../../../src/serialization/tasks");
    await import("../../../src/serialization/tasks/env.ts");
    await import("../../../src/serialization/tasks/env/index.ts");
    await import("../../../src/serialization/tasks/serialization.ts");
    await import("../../../src/serialization/tasks/serialization/index.ts");
    await import("../../../src/serialization/tasks/serialization/helpers.ts");
    await import("../../../src/serialization/tasks/serialization/helpers/index.ts");
    await import("../../../src/serialization/sitecore-api.ts");
    await import("../../../src/serialization/sitecore-api/index.ts");
    await import("../../../src/serialization/filesystem-store.ts");
    await import("../../../src/serialization/filesystem-store/index.ts");
    await import("../../../src/deploy/api/common.ts");
    await import("../../../src/deploy/api/common/index.ts");
    await import("../../../src/config/index.ts");
  });
});
