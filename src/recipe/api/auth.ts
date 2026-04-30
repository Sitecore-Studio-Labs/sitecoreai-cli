/**
 * Recipe-side auth surface — re-export of scai's serialization OAuth/token
 * plumbing. The recipe Authoring API uses the same Bearer token as the
 * Management API, so there's nothing new here; this file exists so
 * `src/recipe/api/*` is self-contained and can be mocked at one
 * predictable seam in tests.
 */
export { getAccessToken } from "@/serialization/sitecore-api/auth";
