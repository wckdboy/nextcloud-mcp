import * as z from "zod/v4";
import { UserInputError } from "../errors.js";
import { openLocalReadStream, resolveUploadSource } from "../local-path.js";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z
  .object({
    path: z.string().describe("Destination path relative to the Nextcloud files root."),
    localPath: z
      .string()
      .describe("Absolute path of an existing file on the MCP host. The bytes are read from disk. Inline content and base64 are not accepted."),
    contentType: z.string().optional().describe("Optional Content-Type. Defaults to application/octet-stream."),
    overwrite: z.boolean().optional().describe("Replace an existing Nextcloud file. Default false."),
    parents: z.boolean().optional().describe("Create missing parent folders on Nextcloud. Default false."),
  })
  .strict();

export const uploadFile = defineCapability({
  name: "upload_file",
  title: "Upload local file",
  description:
    "Upload a file that already exists on the MCP host. Reads the absolute localPath from disk and sends the bytes with WebDAV PUT. Does not accept inline content or base64. Refuses a relative localPath, any '..' segment, and a path that cannot be resolved. Checks the file size against NEXTCLOUD_MAX_WRITE_BYTES before upload. Refuses to replace an existing Nextcloud file unless overwrite is true. Set parents true to create missing parent folders.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const path = normalizeNextcloudPath(input.path);
    const source = await resolveUploadSource(input.localPath);
    if (source.byteLength > ctx.limits.maxWriteBytes) {
      throw new UserInputError(
        `Refusing to upload ${source.byteLength} bytes. The write limit is ${ctx.limits.maxWriteBytes} bytes (NEXTCLOUD_MAX_WRITE_BYTES).`,
      );
    }
    const contentType = input.contentType ?? "application/octet-stream";
    await ctx.client.writeFile(
      path,
      {
        byteLength: source.byteLength,
        open: () => openLocalReadStream(source.realPath),
      },
      {
        contentType,
        overwrite: input.overwrite ?? false,
        parents: input.parents ?? false,
      },
    );
    return toolJson({
      wrote: true,
      path,
      localPath: source.realPath,
      bytes: source.byteLength,
      contentType,
    });
  },
});
