import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PathError } from "../src/errors.js";
import { isFilesRoot, normalizeNextcloudPath, parentPath } from "../src/paths.js";

describe("normalizeNextcloudPath", () => {
  it("treats empty and slash as the files root", () => {
    assert.equal(normalizeNextcloudPath(""), "");
    assert.equal(normalizeNextcloudPath("/"), "");
    assert.equal(normalizeNextcloudPath("///"), "");
    assert.equal(isFilesRoot("/"), true);
  });

  it("drops dot segments and a leading slash", () => {
    assert.equal(normalizeNextcloudPath("/foo/./bar/"), "foo/bar");
    assert.equal(parentPath("foo/bar/baz.txt"), "foo/bar");
    assert.equal(parentPath("baz.txt"), "");
  });

  it("rejects parent segments, including encoded and double-encoded forms", () => {
    for (const path of ["../etc/passwd", "foo/../../etc", "foo/%2e%2e/bar", "%2e%2e/%2e%2e/etc", "%252e%252e/secret", "foo/%2f%2e%2e/bar"]) {
      assert.throws(() => normalizeNextcloudPath(path), PathError);
    }
  });

  it("rejects backslashes, nulls, controls, and URLs", () => {
    assert.throws(() => normalizeNextcloudPath("foo\\bar"), PathError);
    assert.throws(() => normalizeNextcloudPath("foo%5cbar"), PathError);
    assert.throws(() => normalizeNextcloudPath("foo\0bar"), PathError);
    assert.throws(() => normalizeNextcloudPath("foo%00bar"), PathError);
    assert.throws(() => normalizeNextcloudPath("https://cloud.example.com/remote.php/dav/files/alice/x"), PathError);
  });

  it("decodes a normal encoded name", () => {
    assert.equal(normalizeNextcloudPath("My%20Folder/notes.txt"), "My Folder/notes.txt");
  });
});
