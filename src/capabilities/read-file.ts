import * as z from "zod/v4";
import { decodeUtf8, isBinaryPayload } from "../bytes.js";
import { UserInputError } from "../errors.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to the Nextcloud files root."),
  encoding: z
    .enum(["text", "base64"])
    .optional()
    .describe('Omit for UTF-8 text. Pass "base64" for binary files. Text mode refuses binary payloads.'),
});

export const readFile = defineCapability({
  name: "read_file",
  title: "Read file",
  description:
    "Read a file from Nextcloud. Text is returned as UTF-8. Binary files are refused unless encoding is base64. Files larger than the server read limit are refused rather than truncated.",
  inputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const info = await ctx.client.stat(input.path);
    if (info.isDirectory) {
      throw new UserInputError(`${info.path || "/"} is a folder. Use list_directory instead of read_file.`);
    }
    const file = await ctx.client.readFile(input.path, ctx.limits.maxReadBytes);
    const binary = isBinaryPayload(file.contentType, file.bytes);
    if (input.encoding === "base64") {
      return toolJson({
        path: info.path,
        encoding: "base64",
        contentType: file.contentType,
        size: file.byteLength,
        content: Buffer.from(file.bytes).toString("base64"),
      });
    }
    if (binary) {
      throw new UserInputError(
        `Refusing to return binary file ${info.path} as text (content type ${file.contentType ?? "unknown"}). Call read_file again with encoding "base64".`,
      );
    }
    const text = decodeUtf8(file.bytes);
    if (text === null) {
      throw new UserInputError(
        `File ${info.path} is not valid UTF-8. Call read_file again with encoding "base64".`,
      );
    }
    return toolJson({
      path: info.path,
      encoding: "utf8",
      contentType: file.contentType,
      size: file.byteLength,
      content: text,
    });
  },
});
