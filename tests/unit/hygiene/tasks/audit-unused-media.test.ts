/**
 * `scai hygiene audit unused-media list` — two-pass scan: enumerate
 * media-library items, then enumerate content items and subtract the
 * media refs they carry. Leftover media items are "unused".
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditUnusedMedia } from "../../../../src/hygiene/tasks/audit/unused-media";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface MediaItem {
  id: string;
  path: string;
  templateName?: string;
}
interface ContentItem {
  id: string;
  fields: Array<{ name: string; value: string }>;
}

const MEDIA_ROOT = "/sitecore/media library";

/**
 * The runner calls `searchAll` twice — pass 1 with a `_path` filter
 * scoped to the media-library root, pass 2 (via `scanItemsAndFields`)
 * scoped to the content root. Distinguish by the criteria value.
 */
const setup = (media: MediaItem[], content: ContentItem[]): HygieneApiClient => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  // `scanItemsAndFields` normalizes item ids (lowercase, no dashes/braces)
  // before calling `getItemFieldsBatch`, so the fields map must key on the
  // normalized form to match.
  const norm = (id: string): string => id.toLowerCase().replace(/[{}-]/g, "");
  const fieldsMap = new Map(
    content.map((it) => [norm(it.id), it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const client = {
    search: vi
      .fn()
      .mockImplementation((q: { searchStatement?: { criteria?: { value?: string } } }) => {
        const value = q.searchStatement?.criteria?.value ?? "";
        if (value === MEDIA_ROOT.toLowerCase()) {
          return Promise.resolve({
            totalCount: 1,
            results: [{ itemId: "mediarootid", path: MEDIA_ROOT }],
          });
        }
        if (value === "/sitecore/content") {
          return Promise.resolve({
            totalCount: 1,
            results: [{ itemId: "contentrootid", path: "/sitecore/content" }],
          });
        }
        return Promise.resolve({ totalCount: 0, results: [] });
      }),
    searchAll: vi
      .fn()
      .mockImplementation((q: { searchStatement?: { criteria?: { value?: string } } }) => {
        const value = q.searchStatement?.criteria?.value ?? "";
        // mediarootid (normalized) → pass 1, contentrootid → pass 2.
        const isMediaPass = value === "mediarootid";
        return (async function* () {
          if (isMediaPass) {
            for (const m of media) {
              yield {
                itemId: m.id,
                path: m.path,
                name: m.id,
                templateName: m.templateName ?? "Jpeg",
                language: { name: "en" },
              };
            }
          } else {
            for (const c of content) {
              yield {
                itemId: c.id,
                path: `/sitecore/content/${c.id}`,
                name: c.id,
                templateName: "Page",
                language: { name: "en" },
                version: 1,
              };
            }
          }
        })();
      }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, fieldsMap.get(id) ?? null);
      return Promise.resolve(m);
    }),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const MEDIA_GUID = "{aaaa1111-2222-3333-4444-555566667777}";
const MEDIA_NORM = MEDIA_GUID.toLowerCase().replace(/[{}-]/g, "");

describe("audit unused-media — report shape", () => {
  it("returns empty when every media item is referenced by content", async () => {
    setup(
      [{ id: MEDIA_NORM, path: "/images/logo" }],
      [
        {
          id: "page-a",
          fields: [{ name: "Banner", value: `<image mediaid="${MEDIA_GUID}" />` }],
        },
      ]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags a media item that no content item references", async () => {
    setup(
      [{ id: MEDIA_NORM, path: "/images/orphan", templateName: "Jpeg" }],
      [{ id: "page-a", fields: [{ name: "Body", value: "no media here" }] }]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: MEDIA_NORM,
      path: "/images/orphan",
      templateName: "Jpeg",
    });
  });

  it("recognises a media ref inside a RichText <link linktype=media> tag", async () => {
    setup(
      [{ id: MEDIA_NORM, path: "/images/inline" }],
      [
        {
          id: "page-a",
          fields: [
            {
              name: "Body",
              value: `<p><link linktype="media" id="${MEDIA_GUID}">caption</link></p>`,
            },
          ],
        },
      ]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toEqual([]);
  });

  it("recognises a bare-GUID Multilist ref pointing at a media candidate", async () => {
    setup(
      [{ id: MEDIA_NORM, path: "/images/multilist" }],
      [{ id: "page-a", fields: [{ name: "Gallery", value: `${MEDIA_GUID}|otherid` }] }]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toEqual([]);
  });

  it("skips the media-library root item itself", async () => {
    // The media root item has itemId === resolved mediaRootId; it must
    // not surface as an unused media candidate.
    setup(
      [{ id: "mediarootid", path: MEDIA_ROOT }],
      [{ id: "page-a", fields: [{ name: "Body", value: "x" }] }]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toEqual([]);
  });

  it("reports multiple unused media items sorted by path", async () => {
    setup(
      [
        { id: "11111111111111111111111111111111", path: "/images/zeta" },
        { id: "22222222222222222222222222222222", path: "/images/alpha" },
      ],
      [{ id: "page-a", fields: [{ name: "Body", value: "nothing" }] }]
    );
    const reports = await runAuditUnusedMedia({ json: true });
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.path)).toEqual(["/images/alpha", "/images/zeta"]);
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup(
      [{ id: MEDIA_NORM, path: "/images/orphan" }],
      [{ id: "page-a", fields: [{ name: "Body", value: "x" }] }]
    );
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runAuditUnusedMedia({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.unused-media.list");
    expect(parsed.count).toBe(1);
    expect(parsed.meta.mediaScanned).toBe(1);
  });
});

describe("audit unused-media — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("nope"), { code: "CONFIG_NOT_FOUND" });
    });
    await expect(runAuditUnusedMedia({ json: true })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});
