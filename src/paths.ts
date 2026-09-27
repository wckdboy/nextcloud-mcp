import { PathError } from "./errors.js";

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

/**
 * Normalize a user-supplied path to a relative Nextcloud files path.
 * `.` segments are dropped. `..`, backslashes, nulls, and encoded traversal are rejected.
 * `""` and `"/"` are the files root.
 */
export function normalizeNextcloudPath(input: string): string {
  if (typeof input !== "string") {
    throw new PathError("Path must be a string.");
  }
  const trimmed = input.trim();
  if (trimmed.includes("://")) {
    throw new PathError("Path must be relative to the Nextcloud files root, not a URL.");
  }

  const decoded = decodeRepeated(trimmed);
  if (hasControlChar(decoded) || decoded.includes("\\") || decoded.includes("\0")) {
    throw new PathError("Path contains a forbidden character.");
  }

  const segments: string[] = [];
  for (const raw of decoded.split("/")) {
    if (raw === "" || raw === ".") {
      continue;
    }
    if (raw === "..") {
      throw new PathError("Path traversal is not allowed.");
    }
    if (raw.length > MAX_SEGMENT_LENGTH) {
      throw new PathError("A path segment is too long.");
    }
    segments.push(raw.normalize("NFC"));
  }

  const path = segments.join("/");
  if (path.length > MAX_PATH_LENGTH) {
    throw new PathError("Path is too long.");
  }
  return path;
}

export function isFilesRoot(path: string): boolean {
  return normalizeNextcloudPath(path) === "";
}

export function parentPath(path: string): string {
  const normalized = normalizeNextcloudPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) {
    return "";
  }
  return normalized.slice(0, slash);
}

export function encodeRelativePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function decodeRepeated(input: string): string {
  let current = input;
  for (let i = 0; i < 3; i += 1) {
    if (!/%[0-9a-fA-F]{2}/.test(current)) {
      break;
    }
    let next: string;
    try {
      next = decodeURIComponent(current.replaceAll("+", "%2B"));
    } catch {
      throw new PathError("Path contains invalid percent-encoding.");
    }
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
