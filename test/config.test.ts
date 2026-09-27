import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig, normalizeBaseUrl } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

const required = {
  NEXTCLOUD_URL: "https://cloud.example.com/",
  NEXTCLOUD_USERNAME: "alice",
  NEXTCLOUD_APP_PASSWORD: "app-secret",
};

describe("config", () => {
  it("normalizes a trailing slash and keeps a subdirectory", () => {
    assert.equal(normalizeBaseUrl("https://cloud.example.com/"), "https://cloud.example.com");
    assert.equal(normalizeBaseUrl("https://cloud.example.com/nextcloud/"), "https://cloud.example.com/nextcloud");
  });

  it("rejects credentials in the URL and missing secrets", () => {
    assert.throws(() => normalizeBaseUrl("https://alice:secret@cloud.example.com"), ConfigError);
    assert.throws(
      () => loadConfig({ NEXTCLOUD_URL: "https://cloud.example.com" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.deepEqual(error.missing, ["NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD"]);
        return true;
      },
    );
  });

  it("loads defaults and refuses a public bind without a token", () => {
    const config = loadConfig(required);
    assert.equal(config.baseUrl, "https://cloud.example.com");
    assert.equal(config.limits.maxReadBytes, 1024 * 1024);
    assert.equal(config.httpHost, "127.0.0.1");
    assert.equal(config.httpToken, null);
    assert.throws(
      () => loadConfig({ ...required, MCP_HTTP_HOST: "0.0.0.0" }),
      /MCP_HTTP_TOKEN/,
    );
  });
});
