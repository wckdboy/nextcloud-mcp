import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError } from "../src/errors.js";
import { appPasswordAuthorization, withAppPasswordAuth } from "../src/nextcloud/auth.js";

describe("app password auth", () => {
  it("builds HTTP Basic from the user id and app token", () => {
    const header = appPasswordAuthorization("alice", "app-secret");
    assert.equal(header, `Basic ${Buffer.from("alice:app-secret").toString("base64")}`);
    const headers = withAppPasswordAuth(header, { Depth: "1", "OCS-APIRequest": "true" });
    assert.equal(headers.Authorization, header);
    assert.equal(headers.Depth, "1");
    assert.equal("Cookie" in headers, false);
  });

  it("refuses an empty app token, a session cookie, and a replacement Authorization header", () => {
    assert.throws(() => appPasswordAuthorization("alice", "  "), ConfigError);
    const header = appPasswordAuthorization("alice", "app-secret");
    assert.throws(() => withAppPasswordAuth(header, { Cookie: "nc_session=1" }), /Session cookies are not sent/);
    assert.throws(() => withAppPasswordAuth(header, { Authorization: "Bearer oauth-token" }), /HTTP Basic/);
    assert.throws(() => withAppPasswordAuth("Bearer oauth-token"), /HTTP Basic/);
  });
});