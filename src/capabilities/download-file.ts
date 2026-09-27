import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import * as z from "zod/v4";
import { UserInputError } from "../errors.js";
import { resolveDownloadDestination } from "../local-path.js";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z
  .object({
    path: z.string().describe("Source file path relative to the Nextcloud files root."),
    localPath: z
      .string()
      .describe("Absolute destination path on the MCP host. Parent directory must exist. File bytes are written here and are not returned."),
    overwrite: z.boolean().optional().describe("Replace an existing local file. Default false."),
  })
  .strict();

export const downloadFile = defineCapability({
  name: "download_file",
  title: "Download file to disk",
  description:
    "Download a Nextcloud file with WebDAV GET and write it to an absolute localPath on the MCP host. Does not return file bytes or base64. The size ceiling is NEXTCLOUD_MAX_WRITE_BYTES, the same limit as uploads. Oversized files are refused and not truncated. Refuses a relative localPath, any '..' segment, a missing parent directory, and a symlink destination. Refuses to replace an existing local file unless overwrite is true.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const remotePath = normalizeNextcloudPath(input.path);
    const overwrite = input.overwrite ?? false;
    const finalPath = await resolveDownloadDestination(input.localPath, overwrite);
    const info = await ctx.client.stat(remotePath);
    if (info.isDirectory) {
      throw new UserInputError(`${info.path || "/"} is a folder. Use list_directory instead of download_file.`);
    }

    const tmpPath = path.join(path.dirname(finalPath), `.nc-download-${randomBytes(8).toString("hex")}.partial`);
    const writable = createWriteStream(tmpPath, { flags: "wx" });
    try {
      await once(writable, "open");
      const downloaded = await ctx.client.downloadFile(remotePath, ctx.limits.maxWriteBytes, writable);
      writable.end();
      await finished(writable);
      await rename(tmpPath, finalPath);
      return toolJson({
        downloaded: true,
        path: remotePath,
        localPath: finalPath,
        bytes: downloaded.byteLength,
        contentType: downloaded.contentType,
      });
    } catch (error) {
      writable.destroy();
      await finished(writable).catch(() => undefined);
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  },
});
