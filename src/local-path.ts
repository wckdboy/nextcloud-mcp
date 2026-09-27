import { constants, createReadStream, openSync, type ReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { UserInputError } from "./errors.js";

const MAX_LOCAL_PATH_LENGTH = 4096;

/**
 * Host path for upload_file / download_file.
 * `..` is rejected before the filesystem is touched. realpath then resolves
 * symlinks and fails when the path is missing, so the transfer opens the
 * canonical file Node can see.
 */
export async function resolveUploadSource(localPath: string): Promise<{ realPath: string; byteLength: number }> {
  assertAbsoluteLocalPath(localPath);
  const realPath = await resolveExisting(localPath);
  assertAbsoluteLocalPath(realPath);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(realPath);
  } catch (error) {
    throw localFileError(error, localPath);
  }
  if (!info.isFile()) {
    throw new UserInputError("localPath is not a regular file.");
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw new UserInputError("Local file size is invalid.");
  }
  return { realPath, byteLength: info.size };
}

export function openLocalReadStream(realPath: string): ReadStream {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = openSync(realPath, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw localFileError(error, realPath);
  }
  return createReadStream(realPath, { fd, autoClose: true });
}

/**
 * Destination file for download_file. The parent must already exist.
 * A symlink at the final component is refused so the write cannot replace
 * a different file through that link. Missing parents are not created.
 */
export async function resolveDownloadDestination(localPath: string, overwrite: boolean): Promise<string> {
  assertAbsoluteLocalPath(localPath);
  const base = path.basename(localPath);
  if (base.length === 0 || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
    throw new UserInputError("localPath must name a file.");
  }
  const parent = path.dirname(localPath);
  const realParent = await resolveExisting(parent);
  let parentInfo: Awaited<ReturnType<typeof stat>>;
  try {
    parentInfo = await stat(realParent);
  } catch (error) {
    throw localFileError(error, parent);
  }
  if (!parentInfo.isDirectory()) {
    throw new UserInputError("localPath parent is not a directory.");
  }
  const finalPath = path.join(realParent, base);
  const relative = path.relative(realParent, finalPath);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new UserInputError("localPath escapes its parent directory.");
  }

  try {
    const existing = await lstat(finalPath);
    if (existing.isSymbolicLink()) {
      throw new UserInputError("Refusing to write through a symlink. Pass the real file path and overwrite: true to replace a file.");
    }
    if (existing.isDirectory()) {
      throw new UserInputError("localPath is a directory.");
    }
    if (!existing.isFile()) {
      throw new UserInputError("localPath is not a regular file.");
    }
    if (!overwrite) {
      throw new UserInputError(`${finalPath} already exists. Pass overwrite: true to replace it.`);
    }
  } catch (error) {
    if (error instanceof UserInputError) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      return finalPath;
    }
    throw localFileError(error, localPath);
  }
  return finalPath;
}

function assertAbsoluteLocalPath(localPath: string): void {
  if (typeof localPath !== "string" || localPath.length === 0 || localPath.length > MAX_LOCAL_PATH_LENGTH) {
    throw new UserInputError("localPath must be an absolute path on the MCP host.");
  }
  if (hasControlChar(localPath)) {
    throw new UserInputError("localPath contains a forbidden character.");
  }
  if (!path.isAbsolute(localPath)) {
    throw new UserInputError("localPath must be an absolute path on the MCP host. Relative paths are refused.");
  }
  const segments = localPath.split(/[/\\]+/);
  if (segments.includes("..")) {
    throw new UserInputError("localPath must not contain '..'.");
  }
}

async function resolveExisting(localPath: string): Promise<string> {
  try {
    return await realpath(localPath);
  } catch (error) {
    throw localFileError(error, localPath);
  }
}

function localFileError(error: unknown, localPath: string): UserInputError {
  const code = errorCode(error);
  switch (code) {
    case "ENOENT":
      return new UserInputError(`Local path not found: ${localPath}`);
    case "ELOOP":
      return new UserInputError(`Refusing to follow a symlink at ${localPath}.`);
    case "EACCES":
    case "EPERM":
      return new UserInputError(`Cannot access local path: ${localPath}`);
    default:
      return new UserInputError(`Cannot use local path ${localPath}${code ? ` (${code})` : ""}.`);
  }
}

function errorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
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
