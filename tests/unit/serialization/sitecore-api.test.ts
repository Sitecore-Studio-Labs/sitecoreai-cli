import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  requestDeviceAuthorization,
  pollDeviceToken,
  requestClientCredentialsToken,
  requestPasswordToken,
} from "../../../src/serialization/api/auth";
import {
  fetchItemMetadata,
  fetchItemData,
  executeSerializationCommands,
} from "../../../src/serialization/api/items";
import { fetchHistoryTimestamp, fetchHistoryEntries } from "../../../src/serialization/api/history";
import { fetchRoles, pushRoleCommands } from "../../../src/serialization/api/roles";
import { fetchUsers, pushUserCommands } from "../../../src/serialization/api/users";
import {
  publishItems,
  checkPublishStatus,
  fetchPublishingTargets,
} from "../../../src/serialization/api/publish";
import { runGraphQL } from "../../../src/serialization/api/graphql";
import { ItemPath } from "../../../src/serialization/item-path";
import { createFieldFilterSet } from "../../../src/serialization/field-filter";
import type { EnvironmentConfiguration } from "../../../src/config/types";

const makeEnv = (overrides: Partial<EnvironmentConfiguration> = {}): EnvironmentConfiguration => ({
  name: "demo",
  host: "https://example.local",
  authority: "https://auth.example.local",
  clientId: "client",
  clientSecret: "secret",
  accessToken: "access",
  cacheAuthenticationToken: false,
  ...overrides,
});

const jsonResponse = (value: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: async () => value,
  text: async () => JSON.stringify(value),
});

describe("sitecore api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: { body?: unknown }) => {
      if (url.includes(".well-known/openid-configuration")) {
        return jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        });
      }
      if (url.includes("/device")) {
        return jsonResponse({
          device_code: "device-code",
          user_code: "user-code",
          verification_uri: "https://auth.example.local/verify",
          expires_in: 30,
          interval: 1,
        });
      }
      if (url.includes("/token")) {
        return jsonResponse({
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.includes("/sitecore/api/management")) {
        const body = init?.body ? JSON.parse(String(init.body)) : { query: "" };
        const query = String(body.query ?? "");
        if (query.includes("serialize(")) {
          return jsonResponse({
            data: {
              serialize: [
                {
                  id: "id-1",
                  parentId: "parent-1",
                  templateId: "template-1",
                  path: "/sitecore/content/home",
                  hasChildren: false,
                  dataSignature: "sig",
                  data: JSON.stringify({
                    id: "id-1",
                    parentId: "parent-1",
                    templateId: "template-1",
                    path: "/sitecore/content/home",
                    dataSignature: "sig",
                    name: "home",
                    branchId: null,
                    sharedFields: [],
                    unversionedFields: [],
                    versions: [],
                  }),
                },
              ],
            },
          });
        }
        if (query.includes("executeSerializationCommands")) {
          return jsonResponse({ data: { executeSerializationCommands: [{ success: true }] } });
        }
        if (query.includes("history")) {
          return jsonResponse({
            data: { history: { currentTimestamp: "now", entries: [] } },
          });
        }
        if (query.includes("users")) {
          return jsonResponse({
            data: {
              users: [
                {
                  userName: "sitecore\\jdoe",
                  email: "jdoe@example.com",
                  comment: "hello",
                  created: new Date().toISOString(),
                  isApproved: true,
                  roles: ["sitecore\\author"],
                  properties: [
                    {
                      key: "FullName",
                      value: "Jane Doe",
                      valueType: "text/plain",
                      isCustomProperty: true,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (query.includes("roles")) {
          return jsonResponse({ data: { roles: [] } });
        }
        if (query.includes("pushRoles") || query.includes("pushCommands")) {
          return jsonResponse({ data: { pushCommands: [{ ok: true }] } });
        }
        if (query.includes("pushUsers")) {
          return jsonResponse({ data: { pushUsers: [{ ok: true }] } });
        }
        if (query.includes("publish(")) {
          return jsonResponse({
            data: { publish: { id: "pub", processedCount: 1, stateName: "Done" } },
          });
        }
        if (query.includes("publishingStatus")) {
          return jsonResponse({
            data: { publishingStatus: { id: "pub", processedCount: 1, stateName: "Done" } },
          });
        }
        if (query.includes("listOfTargets")) {
          return jsonResponse({ data: { listOfTargets: ["master"] } });
        }
        return jsonResponse({ data: {} });
      }
      return jsonResponse({}, false);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("requests device authorization and polls token", async () => {
    const env = makeEnv();
    const device = await requestDeviceAuthorization(env);
    expect(device.deviceCode).toBe("device-code");
    const token = await pollDeviceToken(env, device);
    expect(token.accessToken).toBe("token");
  });

  it("requests client credentials and password tokens", async () => {
    const env = makeEnv();
    const cc = await requestClientCredentialsToken(env);
    expect(cc.accessToken).toBe("token");
    const pw = await requestPasswordToken(env, "user", "pass");
    expect(pw.accessToken).toBe("token");
  });

  it("fetches metadata and data", async () => {
    const env = makeEnv();
    const filter = createFieldFilterSet([], []);
    const metadata = await fetchItemMetadata(
      env,
      "master",
      "/sitecore/content",
      "SingleItem",
      filter,
      false
    );
    expect(metadata[0].path).toBeInstanceOf(ItemPath);
    const data = await fetchItemData(env, "master", "/sitecore/content", "SingleItem", filter);
    expect(data.length).toBeGreaterThan(0);
  });

  it("executes serialization commands and history/roles/users", async () => {
    const env = makeEnv();
    const commands = await executeSerializationCommands(env, [{ type: "create" }], "Info");
    expect(commands.length).toBeGreaterThan(0);
    const timestamp = await fetchHistoryTimestamp(env);
    expect(timestamp).toBe("now");
    const entries = await fetchHistoryEntries(env, "now");
    expect(entries.entries.length).toBe(0);
    const roles = await fetchRoles(env, []);
    expect(roles.length).toBe(0);
    const pushedRoles = await pushRoleCommands(env, []);
    expect(pushedRoles.length).toBeGreaterThan(0);
    const users = await fetchUsers(env, []);
    expect(users[0].userName).toBe("sitecore\\jdoe");
    const pushedUsers = await pushUserCommands(env, []);
    expect(pushedUsers.length).toBeGreaterThan(0);
  });

  it("publishes and checks status", async () => {
    const env = makeEnv();
    const publish = await publishItems(env, ["id-1"]);
    expect(publish.stateName).toBe("Done");
    const status = await checkPublishStatus(env, publish.id);
    expect(status.id).toBe("pub");
    const targets = await fetchPublishingTargets(env);
    expect(targets).toContain("master");
  });

  it("returns empty lists when GraphQL data is missing", async () => {
    const response = (data: unknown) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
    });
    fetchMock
      .mockResolvedValueOnce(response({ history: { currentTimestamp: "now" } }))
      .mockResolvedValueOnce(response({ roles: null }))
      .mockResolvedValueOnce(response({ users: null }))
      .mockResolvedValueOnce(response({ listOfTargets: null }));
    const env = makeEnv();
    const history = await fetchHistoryEntries(env, "now");
    expect(history.entries).toEqual([]);
    const roles = await fetchRoles(env, []);
    expect(roles).toEqual([]);
    const users = await fetchUsers(env, []);
    expect(users).toEqual([]);
    const targets = await fetchPublishingTargets(env);
    expect(targets).toEqual([]);
  });

  it("maps user defaults when roles/properties are missing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: {
            users: [
              {
                userName: "sitecore\\jdoe",
                created: "2024-01-01",
                isApproved: true,
              },
            ],
          },
        }),
    });
    const env = makeEnv();
    const users = await fetchUsers(env, []);
    expect(users[0]).toMatchObject({
      userName: "sitecore\\jdoe",
      creationDate: "2024-01-01",
      isApproved: true,
      roles: [],
      profileProperties: [],
    });
  });

  it("normalizes host and omits auth header when token is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { ping: true },
      })
    );
    // No token AND no acquisition path: `accessToken` is cleared, and so
    // are `clientId`/`clientSecret` — a resolvable credential pair is now
    // itself an acquisition path, so leaving the `makeEnv` defaults would
    // make `getAccessToken` attempt a client-credentials mint.
    const env = makeEnv({
      host: "example.local/",
      accessToken: undefined,
      authority: undefined,
      clientId: undefined,
      clientSecret: undefined,
    });
    const result = await runGraphQL<{ ping: boolean }>(env, "query { ping }");
    expect(result.ping).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(url).toBe("https://example.local/sitecore/api/management");
    expect(init.headers?.Authorization).toBeUndefined();
  });

  it("includes string and object error payloads for non-ok responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "nope",
    });
    const env = makeEnv();
    await expect(runGraphQL(env, "query { ping }")).rejects.toThrow("nope");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "bad" }),
    });
    await expect(runGraphQL(env, "query { ping }")).rejects.toThrow('{"error":"bad"}');
  });

  it("handles empty error bodies from GraphQL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "",
    });
    const env = makeEnv();
    await expect(runGraphQL(env, "query { ping }")).rejects.toThrow(
      "Sitecore Management API request failed (502)."
    );
  });

  it("throws when auth inputs are missing", async () => {
    await expect(requestDeviceAuthorization(makeEnv({ authority: undefined }))).rejects.toThrow();
    await expect(
      requestClientCredentialsToken(makeEnv({ authority: undefined }))
    ).rejects.toThrow();
    await expect(
      requestPasswordToken(makeEnv({ authority: undefined }), "user", "pass")
    ).rejects.toThrow();
  });

  it("throws when host is not configured", async () => {
    const env = makeEnv({ host: "" });
    const filter = createFieldFilterSet([], []);
    await expect(
      fetchItemMetadata(env, "master", "/sitecore/content", "SingleItem", filter, false)
    ).rejects.toThrow();
  });

  it("throws when graphql returns an error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "error",
    });
    const env = makeEnv();
    await expect(fetchHistoryTimestamp(env)).rejects.toThrow();
  });

  it("fails when device authorization response is incomplete", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: "user-code",
        })
      );
    const env = makeEnv();
    await expect(requestDeviceAuthorization(env)).rejects.toThrow(
      "Device authorization response was missing required fields."
    );
  });

  it("fails when access token is missing from client credentials response", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: null,
        })
      );
    const env = makeEnv();
    await expect(requestClientCredentialsToken(env)).rejects.toThrow(
      "Access token was not returned by the identity server."
    );
  });

  it("throws when token endpoint returns an error", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: "invalid_client",
            error_description: "bad credentials",
          }),
        json: async () => ({}),
      });
    const env = makeEnv();
    await expect(requestClientCredentialsToken(env)).rejects.toThrow(
      "Failed to obtain access token (401): bad credentials"
    );
  });

  it("handles device login denial", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: "access_denied",
            error_description: "denied",
          }),
        json: async () => ({}),
      });
    const env = makeEnv();
    await expect(
      pollDeviceToken(env, {
        deviceCode: "device",
        userCode: "user",
        verificationUri: "https://verify",
        expiresIn: 30,
        interval: 1,
      })
    ).rejects.toThrow("Device login was cancelled.");
  });

  it("throws when GraphQL response contains errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "GraphQL error" }] }),
      text: async () => JSON.stringify({ errors: [{ message: "GraphQL error" }] }),
    });
    const env = makeEnv();
    await expect(fetchHistoryTimestamp(env)).rejects.toThrow("GraphQL error");
  });

  it("throws when GraphQL response is missing data", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}",
    });
    const env = makeEnv();
    await expect(fetchHistoryTimestamp(env)).rejects.toThrow(
      "GraphQL response did not contain data."
    );
  });

  it("throws when GraphQL response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
      text: async () => "not-json",
    });
    const env = makeEnv();
    await expect(fetchHistoryTimestamp(env)).rejects.toThrow(
      "GraphQL response did not contain JSON data."
    );
  });

  it("handles GraphQL timeout errors", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("Abort"), { name: "AbortError" }));
    const env = makeEnv();
    await expect(fetchHistoryTimestamp(env, { timeoutMs: 1 })).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("retries while authorization is pending", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "authorization_pending" }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "token",
            refresh_token: "refresh",
            expires_in: 10,
            token_type: "Bearer",
          }),
        json: async () => ({}),
      });
    const env = makeEnv();
    const promise = pollDeviceToken(env, {
      deviceCode: "device",
      userCode: "user",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const token = await promise;
    vi.useRealTimers();
    expect(token.accessToken).toBe("token");
  });

  it("slows down when instructed by the server", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "slow_down" }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "token",
            refresh_token: "refresh",
            expires_in: 10,
            token_type: "Bearer",
          }),
        json: async () => ({}),
      });
    const env = makeEnv();
    const promise = pollDeviceToken(env, {
      deviceCode: "device",
      userCode: "user",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    });
    await vi.advanceTimersByTimeAsync(6000);
    const token = await promise;
    vi.useRealTimers();
    expect(token.accessToken).toBe("token");
  });

  it("handles device login expiration", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "expired_token" }),
        json: async () => ({}),
      });
    const env = makeEnv();
    await expect(
      pollDeviceToken(env, {
        deviceCode: "device",
        userCode: "user",
        verificationUri: "https://verify",
        expiresIn: 30,
        interval: 1,
      })
    ).rejects.toThrow("Device login expired. Try again.");
  });

  it("throws on unexpected device token errors", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "server_error",
        json: async () => ({}),
      });
    const env = makeEnv();
    await expect(
      pollDeviceToken(env, {
        deviceCode: "device",
        userCode: "user",
        verificationUri: "https://verify",
        expiresIn: 30,
        interval: 1,
      })
    ).rejects.toThrow("Failed to obtain access token");
  });

  it("fails when password token response is not ok", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          device_authorization_endpoint: "https://auth.example.local/device",
          token_endpoint: "https://auth.example.local/token",
        })
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "bad",
        json: async () => ({}),
      });
    const env = makeEnv();
    await expect(requestPasswordToken(env, "user", "pass")).rejects.toThrow();
  });
});
