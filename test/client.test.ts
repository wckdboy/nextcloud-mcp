import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNextcloudClient } from "../src/nextcloud/client.js";
import { NextcloudError, PathError, UserInputError } from "../src/errors.js";
import { recordedFetch, testConfig } from "./helpers.js";

const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Documents</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
        <oc:size>1</oc:size>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/b.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>b.txt</d:displayname>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:getcontentlength>1</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const FILE_STAT = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/notes.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>notes.txt</d:displayname>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:getcontentlength>5</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

function xmlResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "application/xml", ...headers } });
}

describe("Nextcloud client", () => {
  it("lists a folder with PROPFIND depth 1 and basic auth, excluding the folder itself", async () => {
    const { fetchImpl, calls } = recordedFetch(() => xmlResponse(207, LISTING));
    const client = createNextcloudClient(testConfig, { fetchImpl });
    const entries = await client.listDirectory("/Documents/");
    assert.deepEqual(entries.map((entry) => entry.path), ["Documents/b.txt"]);
    assert.equal(calls[0]?.method, "PROPFIND");
    assert.equal(calls[0]?.headers.get("depth"), "1");
    assert.equal(calls[0]?.url, "https://cloud.example.com/remote.php/dav/files/alice/Documents");
    assert.equal(
      calls[0]?.headers.get("authorization"),
      `Basic ${Buffer.from("alice:app-secret").toString("base64")}`,
    );
    assert.equal(calls[0]?.url.includes("app-secret"), false);
    assert.equal(calls[0]?.headers.get("cookie"), null);
    assert.equal(calls[0]?.headers.get("authorization")?.startsWith("Basic "), true);
  });

  it("does not call the network for a traversing path or a root delete", async () => {
    const { fetchImpl, calls } = recordedFetch(() => xmlResponse(500, ""));
    const client = createNextcloudClient(testConfig, { fetchImpl });
    await assert.rejects(() => client.listDirectory("../etc"), PathError);
    await assert.rejects(() => client.delete("/"), UserInputError);
    assert.equal(calls.length, 0);
  });

  it("uploads with PUT only when overwrite is allowed", async () => {
    const { fetchImpl, calls } = recordedFetch((call) => {
      if (call.method === "PROPFIND") {
        return xmlResponse(404, "");
      }
      return xmlResponse(201, "");
    });
    const client = createNextcloudClient(testConfig, { fetchImpl });
    await client.writeFile("notes.txt", Buffer.from("hello"), {
      contentType: "text/plain; charset=utf-8",
      overwrite: false,
      parents: false,
    });
    assert.equal(calls[1]?.method, "PUT");
    assert.equal(calls[1]?.body, "hello");
    assert.equal(calls[1]?.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  it("refuses to overwrite an existing file unless asked", async () => {
    const { fetchImpl, calls } = recordedFetch(() => xmlResponse(207, FILE_STAT));
    const client = createNextcloudClient(testConfig, { fetchImpl });
    await assert.rejects(
      () =>
        client.writeFile("notes.txt", Buffer.from("hello"), {
          contentType: "text/plain",
          overwrite: false,
          parents: false,
        }),
      /overwrite: true/,
    );
    assert.equal(calls.some((call) => call.method === "PUT"), false);
  });

  it("moves with Destination and Overwrite F", async () => {
    const { fetchImpl, calls } = recordedFetch(() => xmlResponse(201, ""));
    const client = createNextcloudClient(testConfig, { fetchImpl });
    await client.move("a.txt", "b.txt", false);
    assert.equal(calls[0]?.method, "MOVE");
    assert.equal(calls[0]?.headers.get("overwrite"), "F");
    assert.equal(
      calls[0]?.headers.get("destination"),
      "https://cloud.example.com/remote.php/dav/files/alice/b.txt",
    );
  });

  it("creates a public share through OCS and does not return the password", async () => {
    const { fetchImpl, calls } = recordedFetch(
      () =>
        new Response(
          JSON.stringify({
            ocs: {
              meta: { status: "ok", statuscode: 200, message: "OK" },
              data: { id: 7, url: "https://cloud.example.com/s/token", token: "token", permissions: 1, path: "/notes.txt", expiration: null, password: "hidden" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = createNextcloudClient(testConfig, { fetchImpl });
    const share = await client.createShareLink({ path: "notes.txt", permissions: 1, password: "hidden" });
    assert.equal(share.url, "https://cloud.example.com/s/token");
    assert.equal("password" in share, false);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.headers.get("ocs-apirequest"), "true");
    assert.match(calls[0]?.url ?? "", /\/ocs\/v2\.php\/apps\/files_sharing\/api\/v1\/shares/);
    assert.match(calls[0]?.body ?? "", /shareType=3/);
    assert.match(calls[0]?.body ?? "", /path=%2Fnotes.txt/);
  });

  it("searches file names with WebDAV SEARCH", async () => {
    const { fetchImpl, calls } = recordedFetch(() => xmlResponse(207, FILE_STAT));
    const client = createNextcloudClient(testConfig, { fetchImpl });
    const entries = await client.search({ query: "notes", path: "", limit: 10 });
    assert.equal(entries[0]?.path, "notes.txt");
    assert.equal(calls[0]?.method, "SEARCH");
    assert.equal(calls[0]?.url, "https://cloud.example.com/remote.php/dav/");
    assert.match(calls[0]?.body ?? "", /<d:literal>%notes%<\/d:literal>/);
    assert.match(calls[0]?.body ?? "", /<d:href>\/files\/alice<\/d:href>/);
  });

  it("refuses redirects and maps 401 without echoing the app password", async () => {
    const redirect = recordedFetch(() => xmlResponse(302, "", { location: "https://evil.example/steal" }));
    const redirecting = createNextcloudClient(testConfig, { fetchImpl: redirect.fetchImpl });
    await assert.rejects(() => redirecting.stat("notes.txt"), /Refused to follow/);
    assert.equal(redirect.calls.length, 1);

    const denied = recordedFetch(() => xmlResponse(401, "nope"));
    const client = createNextcloudClient(testConfig, { fetchImpl: denied.fetchImpl });
    await assert.rejects(
      () => client.stat("notes.txt"),
      (error: unknown) => {
        assert.ok(error instanceof NextcloudError);
        assert.equal(error.status, 401);
        assert.equal(error.message.includes("app-secret"), false);
        return true;
      },
    );
  });

  it("refuses a read larger than the limit without returning a partial body", async () => {
    const { fetchImpl } = recordedFetch(
      () => xmlResponse(200, "abcdef", { "content-type": "text/plain", "content-length": "6" }),
    );
    const client = createNextcloudClient(testConfig, { fetchImpl });
    await assert.rejects(() => client.readFile("notes.txt", 4), /read limit of 4 bytes/);
  });
});
