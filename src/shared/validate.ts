import { createCliError } from "./errors";

const isNonEmpty = (value?: string): boolean => Boolean(value && value.trim().length > 0);

export const assertValidUrl = (value: string, label: string): void => {
  try {
    // Allow absolute URLs only.
    const url = new URL(value);
    if (!url.protocol || !url.hostname) {
      throw new Error("Invalid URL");
    }
  } catch {
    throw createCliError(`${label} must be a valid URL.`, "INPUT_INVALID", {
      hint: `Provide a valid ${label.toLowerCase()} (e.g. https://example.com).`,
    });
  }
};

export const assertValidHost = (value: string, label: string): void => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    assertValidUrl(value, label);
    return;
  }
  if (!isNonEmpty(value) || /\s/.test(value)) {
    throw createCliError(`${label} must be a valid host.`, "INPUT_INVALID", {
      hint: "Provide a hostname or a full URL.",
    });
  }
};
