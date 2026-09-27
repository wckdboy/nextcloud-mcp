import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchXml, filenameLikeLiteral, parseMultiStatus } from "../src/nextcloud/xml.js";

const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Documents</d:displayname>
        <d:getlastmodified>Wed, 20 Jul 2022 05:12:23 GMT</d:getlastmodified>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getetag>&quot;dir-etag&quot;</d:getetag>
        <oc:fileid>10</oc:fileid>
        <oc:permissions>RGDNVCK</oc:permissions>
        <oc:size>42</oc:size>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/notes.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>notes.txt</d:displayname>
        <d:getlastmodified>Thu, 21 Jul 2022 05:12:23 GMT</d:getlastmodified>
        <d:getcontentlength>5</d:getcontentlength>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:resourcetype/>
        <d:getetag>"file-etag"</d:getetag>
        <oc:fileid>11</oc:fileid>
        <oc:size>5</oc:size>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><nc:has-preview/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe("WebDAV XML", () => {
  it("parses a depth listing and ignores missing properties", () => {
    const entries = parseMultiStatus(LISTING, "alice");
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.path, "Documents");
    assert.equal(entries[0]?.isDirectory, true);
    assert.equal(entries[0]?.etag, "dir-etag");
    assert.equal(entries[0]?.size, 42);
    assert.equal(entries[1]?.path, "Documents/notes.txt");
    assert.equal(entries[1]?.isDirectory, false);
    assert.equal(entries[1]?.fileId, "11");
    assert.equal(entries[1]?.size, 5);
  });

  it("builds a filename SEARCH body without letting the query inject XML or LIKE wildcards", () => {
    const literal = filenameLikeLiteral("100% <notes>");
    assert.equal(literal, "%100 &lt;notes&gt;%");
    const xml = buildSearchXml({ username: "alice", path: "Documents", likeLiteral: literal, limit: 25 });
    assert.match(xml, /<d:href>\/files\/alice\/Documents<\/d:href>/);
    assert.ok(xml.includes("<d:literal>%100 &lt;notes&gt;%</d:literal>"));
    assert.match(xml, /<d:nresults>25<\/d:nresults>/);
  });
});
