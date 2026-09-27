import { ConfigError } from "../errors.js";

/**
 * Nextcloud calls use HTTP Basic with the user id and an app password.
 * An app password is the app token from Settings → Security → Devices & sessions.
 * This server does not send session cookies and does not use Login Flow v2 or OAuth.
 */
export function appPasswordAuthorization(username: string, appPassword: string): string {
  if (username.trim() === "" || appPassword.trim() === "") {
    throw new ConfigError(
      "Nextcloud auth requires NEXTCLOUD_USERNAME and NEXTCLOUD_APP_PASSWORD. NEXTCLOUD_APP_PASSWORD is an app token from Settings → Security → Devices & sessions. Session cookies and Login Flow v2/OAuth are not used.",
      ["NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD"],
    );
  }
  return `Basic ${Buffer.from(`${username}:${appPassword}`, "utf8").toString("base64")}`;
}

export function withAppPasswordAuth(
  authorization: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  if (!authorization.startsWith("Basic ")) {
    throw new Error("Nextcloud requests authenticate with HTTP Basic and the app password only.");
  }
  const headers: Record<string, string> = { Authorization: authorization };
  for (const [name, value] of Object.entries(extra)) {
    const key = name.toLowerCase();
    if (key === "cookie") {
      throw new Error(
        "Session cookies are not sent. Nextcloud auth is HTTP Basic with NEXTCLOUD_USERNAME and NEXTCLOUD_APP_PASSWORD.",
      );
    }
    if (key === "authorization") {
      throw new Error("The Authorization header is HTTP Basic with the app password. It cannot be replaced.");
    }
    headers[name] = value;
  }
  return headers;
}
