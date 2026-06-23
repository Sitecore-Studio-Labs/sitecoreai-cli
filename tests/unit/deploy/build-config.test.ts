import { describe, it, expect } from "vitest";
import {
  applyRenderingHost,
  DEFAULT_RENDERING_HOST_NAME,
  type RenderingHostParams,
  type XmcloudBuildConfig,
} from "../../../src/deploy/tasks/build-config";

const params = (over: Partial<RenderingHostParams> = {}): RenderingHostParams => ({
  renderingHostName: "my-host",
  jssDeploymentSecret: "S",
  enabled: true,
  nodeVersion: "24.10.0",
  hostPath: "./",
  type: "sxa",
  installCommand: "npm install",
  buildCommand: "npm run build",
  runCommand: "next:start",
  removeDefault: false,
  ...over,
});

describe("applyRenderingHost", () => {
  it("builds a default config + host when none exists", () => {
    const config = applyRenderingHost(null, params());
    expect(config.renderingHosts["my-host"]).toMatchObject({
      path: "./",
      nodeVersion: "24.10.0",
      jssDeploymentSecret: "S",
      enabled: true,
      type: "sxa",
      runCommand: "next:start",
    });
    // OOTB postActions are seeded.
    expect((config.postActions as { actions: object }).actions).toHaveProperty("warmUpCm");
  });

  it("merges into an existing config — preserves siblings + unknown keys", () => {
    const existing: XmcloudBuildConfig = {
      renderingHosts: { other: { path: "./other", enabled: false } },
      customTopLevel: 42,
    };
    const config = applyRenderingHost(existing, params());
    expect(config.renderingHosts).toHaveProperty("other");
    expect(config.renderingHosts).toHaveProperty("my-host");
    expect(config.customTopLevel).toBe(42);
  });

  it("drops the OOTB default host when removeDefault + a renamed host", () => {
    const existing: XmcloudBuildConfig = {
      renderingHosts: { [DEFAULT_RENDERING_HOST_NAME]: { path: "./" } },
    };
    const config = applyRenderingHost(existing, params({ removeDefault: true }));
    expect(config.renderingHosts).not.toHaveProperty(DEFAULT_RENDERING_HOST_NAME);
    expect(config.renderingHosts).toHaveProperty("my-host");
  });

  it("does not drop the default host when the target IS the default", () => {
    const existing: XmcloudBuildConfig = {
      renderingHosts: { [DEFAULT_RENDERING_HOST_NAME]: { path: "./old" } },
    };
    const config = applyRenderingHost(
      existing,
      params({ renderingHostName: DEFAULT_RENDERING_HOST_NAME, removeDefault: true })
    );
    expect(config.renderingHosts[DEFAULT_RENDERING_HOST_NAME]).toMatchObject({ path: "./" });
  });
});
