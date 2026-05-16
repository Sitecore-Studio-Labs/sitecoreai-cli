/**
 * Region resolution — the single place scai derives a Sitecore
 * organization's region code (e.g. `euw`) and builds a regional API host.
 *
 * Sitecore's regional services share one region per organization and
 * differ only in hostname:
 *   - Agentic Studio  `agentic-studio-{region}.sitecorecloud.io`
 *   - Orchestrate     `ai-workflows-{region}.sitecorecloud.io`
 *   - Brief           `co-brief-api-{region}.sitecorecloud.io`
 *
 * The region itself is read from `platform-inventory` — a versioned
 * (`v1`), legitimate platform service — keyed by the org id scai already
 * holds. Three layers, smallest first:
 *
 *   - `resolveRegion(orgId, token)` — the leaf primitive: one
 *     `platform-inventory` call with a caller-supplied access token.
 *   - `resolveRegionCode({ organizationId, acquireToken })` — env-aware:
 *     mints the token lazily (only on a cache miss) through an injected
 *     callback, so this module depends on nothing but `fetch`.
 *   - `resolveRegionalBaseUrl({ …, hostTemplate, override })` — the
 *     convenience every regional area calls: honour an explicit per-env
 *     host override, else resolve the region and fill a host template.
 *
 * The token must carry `platform.tenants:listall` (scai's automation
 * client is provisioned with it; see `SCAI_API_SCOPES`). The caller owns
 * how that token is obtained — campaign reuses its no-scope Orchestrate
 * token, brief/agents mint a fresh no-scope M2M token — which is why the
 * token enters through a callback rather than a hard dependency.
 */

const PLATFORM_INVENTORY_BASE = "https://platform-inventory.sitecorecloud.io";

/** Region code used when resolution is unavailable — EU West. */
export const DEFAULT_REGION = "euw";

/** Resolved regions, cached per organization for the process lifetime. */
const regionCache = new Map<string, string>();

interface InventoryTenant {
  region?: string | null;
  labels?: { RegionCode?: string | null } | null;
}

/** A tenant carries the region directly, or under `labels.RegionCode`. */
const regionOf = (tenant: InventoryTenant): string | undefined =>
  tenant.region ?? tenant.labels?.RegionCode ?? undefined;

/**
 * Resolve a Sitecore organization's region code from `platform-inventory`.
 *
 * **Best-effort.** Any failure — no/invalid token, wrong audience,
 * network, an org with no regioned tenant — falls back to
 * `DEFAULT_REGION`, so a caller always gets a usable region and a
 * regional host is always buildable. Cached per organization.
 *
 * `accessToken` must carry `platform.tenants:listall`; scai's automation
 * client is provisioned with it.
 */
export const resolveRegion = async (
  organizationId: string,
  accessToken: string
): Promise<string> => {
  const cached = regionCache.get(organizationId);
  if (cached) return cached;

  let region = DEFAULT_REGION;
  try {
    const url =
      `${PLATFORM_INVENTORY_BASE}/api/inventory/v1/tenants` +
      `?organizationId=${encodeURIComponent(organizationId)}&state=Active&pagesize=100`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: InventoryTenant[] };
      for (const tenant of body.data ?? []) {
        const found = regionOf(tenant);
        if (found) {
          region = found;
          break;
        }
      }
    }
  } catch {
    /* best-effort — fall back to DEFAULT_REGION */
  }

  regionCache.set(organizationId, region);
  return region;
};

/** Options shared by the env-aware resolvers. */
export interface ResolveRegionOptions {
  /**
   * Sitecore organization id — the region is derived from it. When
   * absent, resolution is skipped and `DEFAULT_REGION` is used.
   */
  organizationId?: string;
  /**
   * Mints an access token carrying `platform.tenants:listall` for the
   * `platform-inventory` lookup. Invoked only on a region cache miss.
   * May reject or resolve `undefined` — resolution then falls back to
   * `DEFAULT_REGION`.
   */
  acquireToken: () => Promise<string | undefined>;
}

/**
 * Resolve a region code env-aware: org id → token → `platform-inventory`.
 *
 * **Best-effort**, like `resolveRegion`. The `acquireToken` callback is
 * invoked only when the region isn't already cached for the org and no
 * id-less short-circuit applies, so a token is never minted needlessly.
 */
export const resolveRegionCode = async (options: ResolveRegionOptions): Promise<string> => {
  const { organizationId } = options;
  if (!organizationId) return DEFAULT_REGION;

  const cached = regionCache.get(organizationId);
  if (cached) return cached;

  let token: string | undefined;
  try {
    token = await options.acquireToken();
  } catch {
    /* best-effort — a missing/failing token resolver yields DEFAULT_REGION */
  }
  if (!token) return DEFAULT_REGION;

  return resolveRegion(organizationId, token);
};

/**
 * Fill a regional host template — the `{region}` placeholder is replaced
 * with the region code. e.g. `regionalHost("https://ai-workflows-{region}.sitecorecloud.io", "euw")`.
 */
export const regionalHost = (template: string, region: string): string =>
  template.replace("{region}", region);

/** Options for the regional-base-URL convenience. */
export interface ResolveRegionalBaseUrlOptions extends ResolveRegionOptions {
  /**
   * Host template carrying a `{region}` placeholder, scheme included —
   * e.g. `https://ai-workflows-{region}.sitecorecloud.io`.
   */
  hostTemplate: string;
  /**
   * Explicit per-env host override. When set it is returned verbatim —
   * no region resolution, no token mint.
   */
  override?: string;
}

/**
 * Resolve a regional API base URL — the single entry point regional
 * areas (campaign, brief) call to pick their host.
 *
 * An `override` (a per-env pinned host) wins outright. Otherwise the
 * region is resolved from the org id and `hostTemplate` is filled.
 * Best-effort throughout — an unresolvable region yields the
 * `DEFAULT_REGION` host, never an error.
 */
export const resolveRegionalBaseUrl = async (
  options: ResolveRegionalBaseUrlOptions
): Promise<string> => {
  if (options.override) return options.override;
  return regionalHost(options.hostTemplate, await resolveRegionCode(options));
};

/** Drop a cached region — used by tests; the cache is otherwise permanent. */
export const clearRegionCache = (): void => regionCache.clear();
