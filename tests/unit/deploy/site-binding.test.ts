import { describe, expect, it, vi } from "vitest";
import { createSiteBinding } from "../../../src/deploy/site-binding";

interface FakeItem {
  itemId: string;
  path: string;
  fields: Array<{ name: string; value: string }>;
}

const makeClient = (items: Record<string, FakeItem | null>) => ({
  getItem: vi.fn(async (sel: { path: string }) => items[sel.path] ?? null),
  updateItem: vi.fn(async () => undefined),
});

const SG = "/sitecore/content/Collection/e2e/Settings/Site Grouping/e2e";
const HOME = "/sitecore/content/Collection/e2e/Home";
const base = { siteName: "e2e", siteCollection: "Collection" };

const updateFields = (client: ReturnType<typeof makeClient>) =>
  Object.fromEntries(
    (
      client.updateItem.mock.calls[0]![0] as {
        fields: Array<{ fieldName: string; value: { kind: string; value: string } }>;
      }
    ).fields.map((f) => [f.fieldName, f.value])
  );

describe("createSiteBinding", () => {
  it("writes the three Site Grouping fields in apply mode", async () => {
    const client = makeClient({
      [SG]: { itemId: "sg-1", path: SG, fields: [] },
      [HOME]: { itemId: "home-1", path: HOME, fields: [] },
    });
    const result = await createSiteBinding(client as never, base, { apply: true });
    expect(result).toMatchObject({ status: "applied", applied: true });
    expect(client.updateItem).toHaveBeenCalledOnce();
    const fields = updateFields(client);
    expect(fields.HostName).toEqual({ kind: "string", value: "*" });
    expect(fields.RenderingHost).toEqual({ kind: "string", value: "e2e" });
    expect(fields.StartItem).toEqual({ kind: "ref-guid", value: "home-1" });
  });

  it("is idempotent (no-op) when the fields already match", async () => {
    const client = makeClient({
      [SG]: {
        itemId: "sg-1",
        path: SG,
        fields: [
          { name: "RenderingHost", value: "e2e" },
          { name: "HostName", value: "*" },
          { name: "StartItem", value: "{HOME-1}" },
        ],
      },
      [HOME]: { itemId: "home-1", path: HOME, fields: [] },
    });
    const result = await createSiteBinding(client as never, base, { apply: true });
    expect(result).toMatchObject({ status: "no-op", applied: false });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("plans without writing when apply is false (the default)", async () => {
    const client = makeClient({
      [SG]: { itemId: "sg-1", path: SG, fields: [] },
      [HOME]: { itemId: "home-1", path: HOME, fields: [] },
    });
    const result = await createSiteBinding(client as never, base);
    expect(result.status).toBe("plan");
    expect(client.updateItem).not.toHaveBeenCalled();
    expect(result.fields.StartItem).toBe("{HOME-1}");
  });

  it("throws INPUT_INVALID for blank site name / collection", async () => {
    const client = makeClient({});
    await expect(
      createSiteBinding(client as never, { siteName: "  ", siteCollection: "Collection" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(
      createSiteBinding(client as never, { siteName: "e2e", siteCollection: "" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when the Site Grouping or Start Item is missing", async () => {
    await expect(
      createSiteBinding(makeClient({ [SG]: null }) as never, base, { apply: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(
      createSiteBinding(
        makeClient({ [SG]: { itemId: "sg-1", path: SG, fields: [] }, [HOME]: null }) as never,
        base,
        { apply: true }
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("honors renderingHostName / startItemName / hostNamePattern overrides", async () => {
    const LANDING = "/sitecore/content/Collection/e2e/Landing";
    const client = makeClient({
      [SG]: { itemId: "sg-1", path: SG, fields: [] },
      [LANDING]: { itemId: "landing-1", path: LANDING, fields: [] },
    });
    const result = await createSiteBinding(
      client as never,
      {
        ...base,
        renderingHostName: "custom",
        startItemName: "Landing",
        hostNamePattern: "www.example.com",
      },
      { apply: true }
    );
    const fields = updateFields(client);
    expect(fields.RenderingHost).toEqual({ kind: "string", value: "custom" });
    expect(fields.HostName).toEqual({ kind: "string", value: "www.example.com" });
    expect(fields.StartItem).toEqual({ kind: "ref-guid", value: "landing-1" });
    expect(result.fields.StartItem).toBe("{LANDING-1}");
  });
});
