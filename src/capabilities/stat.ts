import * as z from "zod/v4";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("File or folder path relative to the Nextcloud files root. Empty string is the root."),
});

export const statFile = defineCapability({
  name: "stat",
  title: "Get file info",
  description:
    "Get metadata for one file or folder (name, size, type, etag, file id, modified time) via WebDAV PROPFIND. This is the file-info tool.",
  inputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    return toolJson(await ctx.client.stat(input.path));
  },
});
