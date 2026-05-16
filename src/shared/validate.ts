import { createScaiError } from "./errors";

const isNonEmpty = (value?: string): boolean => Boolean(value && value.trim().length > 0);

export const assertValidUrl = (value: string, label: string): void => {
  let url: URL;
  try {
    // Allow absolute URLs only.
    url = new URL(value);
    if (!url.protocol || !url.hostname) {
      throw new Error("Invalid URL");
    }
  } catch {
    throw createScaiError(`${label} must be a valid URL.`, "INPUT_INVALID", {
      hint: `Provide a valid ${label.toLowerCase()} (e.g. https://example.com).`,
    });
  }
  // Reject non-HTTPS schemes by default. http:// is permitted only when
  // the operator sets SITECOREAI_ALLOW_HTTP=1 (dev/test only — Bearer
  // tokens ride this URL unencrypted otherwise). file:, javascript:,
  // ftp:, etc. are always rejected.
  if (url.protocol !== "https:") {
    if (url.protocol === "http:" && process.env.SITECOREAI_ALLOW_HTTP === "1") {
      return;
    }
    throw createScaiError(`${label} must use https:// (got ${url.protocol}//).`, "INPUT_INVALID", {
      hint:
        url.protocol === "http:"
          ? "Bearer tokens would be sent in cleartext. Set SITECOREAI_ALLOW_HTTP=1 only for local development."
          : `Provide a valid ${label.toLowerCase()} starting with https://.`,
    });
  }
};

export const assertValidHost = (value: string, label: string): void => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    assertValidUrl(value, label);
    return;
  }
  if (!isNonEmpty(value) || /\s/.test(value)) {
    throw createScaiError(`${label} must be a valid host.`, "INPUT_INVALID", {
      hint: "Provide a hostname or a full URL.",
    });
  }
};
