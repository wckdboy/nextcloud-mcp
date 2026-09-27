import { ConfigError } from "./errors.js";

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 10 * 1024 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 8787;

const REQUIRED_ENV = ["NEXTCLOUD_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD"] as const;

export interface Limits {
  maxReadBytes: number;
  maxWriteBytes: number;
}

export interface NextcloudConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
  timeoutMs: number;
  limits: Limits;
  httpHost: string;
  httpPort: number;
  httpToken: string | null;
  /** Hostnames allowed in the HTTP Host header when the bind address is not loopback. */
  httpAllowedHosts: readonly string[];
}

export function loadConfig(env: NodeJS.ProcessEnv): NextcloudConfig {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(
      [
        "Refusing to start.",
        "Nextcloud auth is HTTP Basic with an app password (app token), not a session cookie and not Login Flow v2/OAuth.",
        `Missing environment variables: ${missing.join(", ")}.`,
        "Set NEXTCLOUD_URL, NEXTCLOUD_USERNAME, and NEXTCLOUD_APP_PASSWORD.",
        "Create the app password in Nextcloud: Settings → Security → Devices & sessions → Create new app password.",
        "Do not paste the account password or the app password into chat.",
      ].join(" "),
      missing,
    );
  }

  const username = env.NEXTCLOUD_USERNAME?.trim() ?? "";
  if (username.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(username)) {
    throw new ConfigError("NEXTCLOUD_USERNAME contains invalid characters.", ["NEXTCLOUD_USERNAME"]);
  }

  const appPassword = env.NEXTCLOUD_APP_PASSWORD?.trim() ?? "";
  if (appPassword.length > 1024) {
    throw new ConfigError("NEXTCLOUD_APP_PASSWORD is too long.", ["NEXTCLOUD_APP_PASSWORD"]);
  }

  const httpHost = (env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST);
  if (httpHost.length > 255 || /[\s/]/.test(httpHost) || (httpHost.includes(":") && httpHost !== "::1")) {
    throw new ConfigError(
      "MCP_HTTP_HOST must be a hostname or IP without a port. Set MCP_HTTP_PORT separately.",
      ["MCP_HTTP_HOST"],
    );
  }

  const httpToken = env.MCP_HTTP_TOKEN?.trim() || null;
  const httpAllowedHosts = parseAllowedHosts(env.MCP_HTTP_ALLOWED_HOSTS);
  if (!isLoopbackHost(httpHost)) {
    if (!httpToken) {
      throw new ConfigError(
        "MCP_HTTP_TOKEN is required when MCP_HTTP_HOST is not loopback.",
        ["MCP_HTTP_TOKEN"],
      );
    }
    if (httpAllowedHosts.length === 0) {
      throw new ConfigError(
        "MCP_HTTP_ALLOWED_HOSTS is required when MCP_HTTP_HOST is not loopback. List the Host header names clients will send.",
        ["MCP_HTTP_ALLOWED_HOSTS"],
      );
    }
  }

  return {
    baseUrl: normalizeBaseUrl(env.NEXTCLOUD_URL ?? ""),
    username,
    appPassword,
    timeoutMs: readBoundedInt(env, "NEXTCLOUD_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    limits: {
      maxReadBytes: readBoundedInt(env, "NEXTCLOUD_MAX_READ_BYTES", DEFAULT_MAX_READ_BYTES, 1, MAX_READ_BYTES),
      maxWriteBytes: readBoundedInt(env, "NEXTCLOUD_MAX_WRITE_BYTES", DEFAULT_MAX_WRITE_BYTES, 1, MAX_WRITE_BYTES),
    },
    httpHost,
    httpPort: readBoundedInt(env, "MCP_HTTP_PORT", DEFAULT_HTTP_PORT, 1, 65_535),
    httpToken,
    httpAllowedHosts,
  };
}

export function normalizeBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ConfigError("NEXTCLOUD_URL is not a valid URL.", ["NEXTCLOUD_URL"]);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError("NEXTCLOUD_URL must use http or https.", ["NEXTCLOUD_URL"]);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ConfigError("NEXTCLOUD_URL must not include credentials. Use NEXTCLOUD_USERNAME and NEXTCLOUD_APP_PASSWORD.", [
      "NEXTCLOUD_URL",
    ]);
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new ConfigError("NEXTCLOUD_URL must not include a query string or fragment.", ["NEXTCLOUD_URL"]);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (part.includes(":") && !part.startsWith("[") ? `[${part}]` : part));
}

function readBoundedInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}.`, [key]);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}.`, [key]);
  }
  return value;
}
