import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

/**
 * `scai brand kits …` command wiring. The brand SDK primitives and the
 * root-config reader are mocked; tests parse the commander command tree
 * the same way the CLI does and assert the SDK call args, the json vs
 * human output fork, the destructive-delete confirmation, and the
 * set-field value-source parsing.
 */

const brandMocks = vi.hoisted(() => ({
  createBrandKit: vi.fn().mockResolvedValue({ id: "kit-new", name: "X", status: "draft" }),
  deleteBrandKit: vi.fn().mockResolvedValue(undefined),
  getBrandKit: vi
    .fn()
    .mockResolvedValue({ id: "kit-1", name: "Acme", status: "published", industry: "tech" }),
  listBrandKits: vi.fn().mockResolvedValue({
    totalCount: 2,
    pageNumber: 1,
    pageSize: 50,
    data: [
      { id: "kit-1", name: "Acme", status: "published", industry: "tech" },
      { id: "kit-2", name: "Beta", status: "draft" },
    ],
  }),
  listBrandKitFields: vi
    .fn()
    .mockResolvedValue([{ id: "field-1", name: "Brand purpose", order: 0, value: "Why" }]),
  listBrandKitSections: vi
    .fn()
    .mockResolvedValue([{ id: "sec-1", name: "Brand Context", order: 1 }]),
  publishBrandKit: vi.fn().mockResolvedValue({ id: "kit-1", status: "published" }),
  updateBrandKitField: vi.fn().mockResolvedValue({
    id: "field-1",
    name: "Brand purpose",
    type: "text",
    value: "Patched",
    verified: true,
  }),
}));

vi.mock("../../../../src/brand", () => brandMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

// Partial mock of cli-tasks so `confirmDestructive` can be driven per
// test (aborted vs proceeding) while `toLogger` / `inputError` stay real.
const cliTaskMocks = vi.hoisted(() => ({ confirmDestructive: vi.fn() }));
vi.mock("../../../../src/shared/cli-tasks", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/shared/cli-tasks")>(
    "../../../../src/shared/cli-tasks"
  );
  return { ...actual, confirmDestructive: cliTaskMocks.confirmDestructive };
});

import { createBrandKitsCommand } from "../../../../src/commands/brand/kits";
import { createScaiError } from "../../../../src/shared/errors";

const rootWithCredential = {
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
  brand: { org_ABC: { clientId: "cid" } },
};

const runKits = async (args: string[]): Promise<void> => {
  const command = createBrandKitsCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

let tmpDir: string;

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset();
  configMocks.readRootConfiguration.mockReturnValue(rootWithCredential);
  for (const m of Object.values(brandMocks)) m.mockClear();
  // Default: faithfully reproduce the real confirmDestructive contract —
  // `--force` proceeds, otherwise (non-interactive test shell) it throws.
  cliTaskMocks.confirmDestructive.mockReset();
  cliTaskMocks.confirmDestructive.mockImplementation(async (_msg: string, force?: boolean) => {
    if (force) return true;
    throw createScaiError("Confirmation required for destructive action.", "INPUT_INVALID");
  });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-kits-cmd-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("brand kits — resolveClient guards", () => {
  it("throws INPUT_INVALID when no organizationId resolves", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { name: "sandbox" } },
      brand: {},
    });
    await expect(runKits(["list", "--quiet"])).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws AUTH_BRAND_REQUIRED when the org has no Brand credential", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
      brand: {},
    });
    await expect(runKits(["list", "--quiet"])).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });

  it("forwards an explicit --org-id to the SDK client", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ENV", name: "sandbox" } },
      brand: { org_OVERRIDE: { clientId: "cid" } },
    });
    await runKits(["list", "--quiet", "--org-id", "org_OVERRIDE"]);
    expect(brandMocks.listBrandKits).toHaveBeenCalledWith(
      expect.objectContaining({ client: expect.objectContaining({ orgId: "org_OVERRIDE" }) })
    );
  });
});

describe("brand kits list", () => {
  it("forwards pagination flags as numbers", async () => {
    await runKits(["list", "--quiet", "--page-number", "2", "--page-size", "25"]);
    expect(brandMocks.listBrandKits).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 2, pageSize: 25 })
    );
  });

  it("emits raw JSON to stdout with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["list", "--quiet", "--format", "json"]);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.totalCount).toBe(2);
  });
});

describe("brand kits get / sections / fields", () => {
  it("get passes the kitId argument through to getBrandKit", async () => {
    await runKits(["get", "kit-1", "--quiet"]);
    expect(brandMocks.getBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
  });

  it("sections JSON output serializes the section array", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["sections", "kit-1", "--quiet", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload).toEqual([{ id: "sec-1", name: "Brand Context", order: 1 }]);
  });

  it("sections handles an empty kit without throwing", async () => {
    brandMocks.listBrandKitSections.mockResolvedValueOnce([]);
    await runKits(["sections", "kit-1", "--quiet"]);
    expect(brandMocks.listBrandKitSections).toHaveBeenCalled();
  });

  it("fields passes kitId + sectionId positional args", async () => {
    await runKits(["fields", "kit-1", "sec-1", "--quiet"]);
    expect(brandMocks.listBrandKitFields).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1", sectionId: "sec-1" })
    );
  });
});

describe("brand kits create / publish", () => {
  it("forwards optional metadata flags to createBrandKit", async () => {
    await runKits([
      "create",
      "Spotify",
      "--quiet",
      "--industry",
      "music",
      "--brand-name",
      "Spotify AB",
    ]);
    expect(brandMocks.createBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Spotify", industry: "music", brandName: "Spotify AB" })
    );
  });

  it("publish passes the kitId to publishBrandKit", async () => {
    await runKits(["publish", "kit-1", "--quiet"]);
    expect(brandMocks.publishBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
  });
});

describe("brand kits delete (destructive)", () => {
  it("deletes when --force skips the confirmation", async () => {
    await runKits(["delete", "kit-1", "--quiet", "--force"]);
    expect(brandMocks.deleteBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
  });

  it("throws INPUT_INVALID without --force in a non-interactive shell", async () => {
    // The test environment is non-interactive (stdin/stdout `isTTY`
    // undefined), so confirmDestructive refuses without --force.
    await expect(runKits(["delete", "kit-1", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(brandMocks.deleteBrandKit).not.toHaveBeenCalled();
  });

  it("aborts without deleting when the confirmation is declined", async () => {
    cliTaskMocks.confirmDestructive.mockResolvedValueOnce(false);
    await runKits(["delete", "kit-1", "--quiet"]);
    expect(cliTaskMocks.confirmDestructive).toHaveBeenCalled();
    expect(brandMocks.deleteBrandKit).not.toHaveBeenCalled();
  });

  it("reports the abort with an 'Aborted.' line in text mode", async () => {
    cliTaskMocks.confirmDestructive.mockResolvedValueOnce(false);
    const infoSpy = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
    await runKits(["delete", "kit-1"]);
    expect(infoSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Aborted.");
    infoSpy.mockRestore();
  });

  it("deletes when the confirmation is accepted (interactive)", async () => {
    cliTaskMocks.confirmDestructive.mockResolvedValueOnce(true);
    await runKits(["delete", "kit-2", "--quiet"]);
    expect(brandMocks.deleteBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-2" })
    );
  });
});

describe("brand kits set-field — value-source parsing", () => {
  it("throws INPUT_INVALID when no value source is supplied", async () => {
    await expect(
      runKits(["set-field", "kit-1", "sec-1", "field-1", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when multiple value sources are supplied", async () => {
    await expect(
      runKits([
        "set-field",
        "kit-1",
        "sec-1",
        "field-1",
        "--quiet",
        "--value",
        "a",
        "--value-json",
        "[]",
      ])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("forwards an inline --value string to updateBrandKitField", async () => {
    await runKits([
      "set-field",
      "kit-1",
      "sec-1",
      "field-1",
      "--quiet",
      "--value",
      "Confident voice",
    ]);
    expect(brandMocks.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        sectionId: "sec-1",
        fieldId: "field-1",
        value: "Confident voice",
      })
    );
  });

  it("parses --value-json into an array value", async () => {
    await runKits([
      "set-field",
      "kit-1",
      "sec-1",
      "field-1",
      "--quiet",
      "--value-json",
      '[{"name":"One"},{"name":"Two"}]',
    ]);
    const call = brandMocks.updateBrandKitField.mock.calls.at(-1)![0];
    expect(call.value).toEqual([{ name: "One" }, { name: "Two" }]);
  });

  it("throws INPUT_INVALID on malformed --value-json", async () => {
    await expect(
      runKits(["set-field", "kit-1", "sec-1", "field-1", "--quiet", "--value-json", "{not json"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("reads --value-file content from disk", async () => {
    const file = path.join(tmpDir, "voice.txt");
    fs.writeFileSync(file, "multi-line\ncontent");
    await runKits(["set-field", "kit-1", "sec-1", "field-1", "--quiet", "--value-file", file]);
    const call = brandMocks.updateBrandKitField.mock.calls.at(-1)![0];
    expect(call.value).toBe("multi-line\ncontent");
  });

  it("throws INPUT_INVALID when --value-file does not exist", async () => {
    await expect(
      runKits([
        "set-field",
        "kit-1",
        "sec-1",
        "field-1",
        "--quiet",
        "--value-file",
        path.join(tmpDir, "missing.txt"),
      ])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("forwards --verified / --ai-editable / --intent to updateBrandKitField", async () => {
    await runKits([
      "set-field",
      "kit-1",
      "sec-1",
      "field-1",
      "--quiet",
      "--value",
      "x",
      "--verified",
      "--ai-editable",
      "--intent",
      "Brand voice guidance",
    ]);
    expect(brandMocks.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ verified: true, aiEditable: true, intent: "Brand voice guidance" })
    );
  });

  it("threads --no-verified / --no-ai-editable as false", async () => {
    await runKits([
      "set-field",
      "kit-1",
      "sec-1",
      "field-1",
      "--quiet",
      "--value",
      "x",
      "--no-verified",
      "--no-ai-editable",
    ]);
    expect(brandMocks.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ verified: false, aiEditable: false })
    );
  });

  it("set-field emits JSON output with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits([
      "set-field",
      "kit-1",
      "sec-1",
      "field-1",
      "--quiet",
      "--value",
      "x",
      "--format",
      "json",
    ]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.id).toBe("field-1");
  });
});

describe("brand kits — human-mode (text) rendering", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  const lines = (): string => infoSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("list renders a header line + one line per kit in text mode", async () => {
    await runKits(["list"]);
    const out = lines();
    expect(out).toContain("kit-1");
    expect(out).toContain("Acme");
  });

  it("get renders status + industry + dates in text mode", async () => {
    brandMocks.getBrandKit.mockResolvedValueOnce({
      id: "kit-1",
      name: "Acme",
      status: "published",
      industry: "tech",
      brandName: "Acme Brand",
      description: "A kit",
      createdOn: "2026-01-01",
      updatedOn: "2026-02-01",
    });
    await runKits(["get", "kit-1"]);
    const out = lines();
    expect(out).toContain("published");
    expect(out).toContain("Acme Brand");
  });

  it("sections renders ordered section lines in text mode", async () => {
    brandMocks.listBrandKitSections.mockResolvedValueOnce([
      { id: "sec-2", name: "Visual Identity", order: 2 },
      { id: "sec-1", name: "Brand Context", order: 1 },
    ]);
    await runKits(["sections", "kit-1"]);
    const out = lines();
    expect(out).toContain("Brand Context");
    expect(out).toContain("Visual Identity");
  });

  it("sections reports the empty-kit hint when there are no sections", async () => {
    brandMocks.listBrandKitSections.mockResolvedValueOnce([]);
    await runKits(["sections", "kit-1"]);
    expect(lines()).toContain("BrandIngestion");
  });

  it("sections renders a section with no name and no order", async () => {
    brandMocks.listBrandKitSections.mockResolvedValueOnce([{ id: "sec-x" }]);
    await runKits(["sections", "kit-1"]);
    const out = lines();
    expect(out).toContain("(unnamed)");
    expect(out).toContain("sec-x");
  });

  it("fields renders a long string value truncated to 200 chars", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      { id: "f-1", name: "Story", order: 0, aiEditable: true, value: "y".repeat(400) },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    expect(lines()).toContain("…");
  });

  it("fields renders an array value preview with entry names", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      {
        id: "f-1",
        name: "Pillars",
        order: 0,
        intent: "core pillars",
        value: [{ name: "Trust" }, { name: "Speed" }, { name: "Care" }, { name: "Joy" }],
      },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    const out = lines();
    expect(out).toContain("Trust");
    expect(out).toContain("core pillars");
  });

  it("fields renders the empty-array marker for a zero-length array value", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      { id: "f-1", name: "Empty", order: 0, value: [] },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    expect(lines()).toContain("(empty array)");
  });

  it("fields reports the empty-section message when there are no fields", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([]);
    await runKits(["fields", "kit-1", "sec-1"]);
    expect(lines()).toContain("No fields in this section.");
  });

  it("fields renders a field with no order, no aiEditable flag, and no name", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([{ id: "f-x" }]);
    await runKits(["fields", "kit-1", "sec-1"]);
    const out = lines();
    expect(out).toContain("(unnamed)");
    expect(out).toContain("f-x");
  });

  it("fields renders a short string value verbatim (no truncation)", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      { id: "f-1", name: "Short", order: 0, value: "brief value" },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    expect(lines()).toContain("brief value");
  });

  it("fields renders an array value of three or fewer entries without an ellipsis tail", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      { id: "f-1", name: "Pillars", order: 0, value: [{ name: "A" }, { name: "B" }] },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    const out = lines();
    expect(out).toContain("2 entries");
    expect(out).toContain("A · B");
  });

  it("fields renders a non-string, non-array value as the non-string marker", async () => {
    brandMocks.listBrandKitFields.mockResolvedValueOnce([
      { id: "f-1", name: "Weird", order: 0, value: { nested: true } },
    ]);
    await runKits(["fields", "kit-1", "sec-1"]);
    expect(lines()).toContain("(non-string value)");
  });

  it("create reports the new kit id + next-steps hint in text mode", async () => {
    await runKits(["create", "Acme", "--industry", "tech"]);
    const out = lines();
    expect(out).toContain("kit-new");
    expect(out).toContain("scai brand seed");
  });

  it("create renders the industry line when the new kit has an industry", async () => {
    brandMocks.createBrandKit.mockResolvedValueOnce({
      id: "kit-new",
      name: "X",
      status: "draft",
      industry: "fintech",
    });
    await runKits(["create", "X", "--industry", "fintech"]);
    expect(lines()).toContain("fintech");
  });

  it("create falls back to '?' when the new kit has no status", async () => {
    brandMocks.createBrandKit.mockResolvedValueOnce({ id: "kit-new", name: "X" });
    await runKits(["create", "X"]);
    expect(lines()).toContain("status:   ?");
  });

  it("set-field falls back to '?' when the updated field has no type", async () => {
    brandMocks.updateBrandKitField.mockResolvedValueOnce({
      id: "f-1",
      name: "F",
      value: "v",
      verified: false,
    });
    await runKits(["set-field", "kit-1", "sec-1", "f-1", "--value", "x"]);
    expect(lines()).toContain("type:     ?");
  });

  it("publish reports the published status in text mode", async () => {
    await runKits(["publish", "kit-1"]);
    const out = lines();
    expect(out).toContain("kit-1");
    expect(out).toContain("published");
  });

  it("set-field renders an array-value preview line in text mode", async () => {
    brandMocks.updateBrandKitField.mockResolvedValueOnce({
      id: "f-1",
      name: "Pillars",
      type: "array",
      value: [{ name: "One" }, { name: "Two" }],
      verified: false,
    });
    await runKits(["set-field", "kit-1", "sec-1", "f-1", "--value-json", "[]"]);
    expect(lines()).toContain("2 entries");
  });

  it("set-field truncates a long string value preview to 200 chars in text mode", async () => {
    brandMocks.updateBrandKitField.mockResolvedValueOnce({
      id: "f-1",
      name: "Story",
      type: "text",
      value: "z".repeat(400),
      verified: true,
    });
    await runKits(["set-field", "kit-1", "sec-1", "f-1", "--value", "x"]);
    const out = lines();
    expect(out).toContain("…");
    expect(out).toContain("verified: true");
  });

  it("set-field renders an object-shaped value as (object) in text mode", async () => {
    brandMocks.updateBrandKitField.mockResolvedValueOnce({
      id: "f-1",
      name: "Meta",
      type: "object",
      value: { nested: true },
      verified: false,
    });
    await runKits(["set-field", "kit-1", "sec-1", "f-1", "--value", "x"]);
    expect(lines()).toContain("(object)");
  });

  it("set-field renders a short string value verbatim in text mode", async () => {
    brandMocks.updateBrandKitField.mockResolvedValueOnce({
      id: "f-1",
      name: "Tagline",
      type: "text",
      value: "Just do it",
      verified: false,
    });
    await runKits(["set-field", "kit-1", "sec-1", "f-1", "--value", "x"]);
    expect(lines()).toContain("Just do it");
  });

  it("create emits JSON output with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["create", "Acme", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.id).toBe("kit-new");
  });

  it("publish emits JSON output with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["publish", "kit-1", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.id).toBe("kit-1");
  });

  it("get emits JSON output with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["get", "kit-1", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.id).toBe("kit-1");
  });

  it("fields emits JSON output with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runKits(["fields", "kit-1", "sec-1", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(Array.isArray(payload)).toBe(true);
  });
});
