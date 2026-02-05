const COLORS: Record<string, string> = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const toBoolean = (value?: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
};

const isCI = (): boolean =>
  Boolean(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL ||
    process.env.TEAMCITY_VERSION
  );

const shouldUseColor = (): boolean => {
  if (!process.stdout.isTTY) {
    return false;
  }
  if (process.env.NO_COLOR || process.env.TERM === "dumb") {
    return false;
  }
  return true;
};

const colorize = (value: string, color?: keyof typeof COLORS): string => {
  if (!color || !shouldUseColor()) {
    return value;
  }
  return `${COLORS[color]}${value}${COLORS.reset}`;
};

export const showBanner = (version: string): void => {
  const force = toBoolean(process.env.SITECOREAI_BANNER);
  if (force === false) {
    return;
  }
  if (process.env.SITECOREAI_QUIET === "1" || process.env.SITECOREAI_JSON === "1") {
    return;
  }
  if (!process.stdout.isTTY || isCI()) {
    return;
  }

  console.log(colorize("SitecoreAI Deploy & Sync CLI", "cyan"));
  console.log(colorize(`v${version}`, "magenta"));
  console.log(colorize(" Type 'scai --help' to get started.\n", "gray"));
};
