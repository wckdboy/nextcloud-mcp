import * as z from "zod/v4";
import { decodeBase64 } from "../bytes.js";
import { UserInputError } from "../errors.js";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("Destination path relative to the Nextcloud files root."),
  content: z.string().describe("File contents. UTF-8 text, or base64 when encoding is base64."),
  encoding: z.enum(["utf8", "base64"]).optional().describe("utf8 (default) or base64."),
  contentType: z.string().optional().describe("Optional Content-Type. Defaults to text/plain or application/octet-stream."),
  overwrite: z.boolean().optional().describe("Replace an existing file. Default false."),
  parents: z.boolean().optional().describe("Create missing parent folders. Default false."),
});

export const writeFile = defineCapability({
  name: "write_file",
  title: "Write file",
  description:
    "Create or upload a file over WebDAV PUT. Refuses to overwrite an existing file unless overwrite is true. Set parents true to create missing parent folders. Does not delete anything else.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const path = normalizeNextcloudPath(input.path);
    const encoding = input.encoding ?? "utf8";
    const bytes = encodeContent(encoding, input.content);
    if (bytes.byteLength > ctx.limits.maxWriteBytes) {
      throw new UserInputError(
        `Refusing to upload ${bytes.byteLength} bytes. The write limit is ${ctx.limits.maxWriteBytes} bytes (NEXTCLOUD_MAX_WRITE_BYTES).`,
      );
    }
    const contentType = input.contentType ?? (encoding === "base64" ? "application/octet-stream" : "text/plain; charset=utf-8");
    await ctx.client.writeFile(path, bytes, {
      contentType,
      overwrite: input.overwrite ?? false,
      parents: input.parents ?? false,
    });
    return toolJson({ wrote: true, path, bytes: bytes.byteLength, contentType });
  },
});

function encodeContent(encoding: "utf8" | "base64", content: string): Uint8Array {
  switch (encoding) {
    case "utf8":
      return Buffer.from(content, "utf8");
    case "base64":
      try {
        return decodeBase64(content);
      } catch (error) {
        const message = error instanceof Error ? error.message : "content is not valid base64.";
        throw new UserInputError(message);
      }
    default: {
      const unexpected: never = encoding;
      throw new UserInputError(`Unsupported encoding: ${String(unexpected)}`);
    }
  }
}
