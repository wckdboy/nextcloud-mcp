import * as z from "zod/v4";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("Folder path relative to the Nextcloud files root."),
  parents: z.boolean().optional().describe("Create missing ancestor folders. Default false."),
});

export const mkdir = defineCapability({
  name: "mkdir",
  title: "Create folder",
  description:
    "Create a folder with WebDAV MKCOL. Set parents true to create missing ancestors. Refuses when a path segment already exists as a file.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handle(input, ctx) {
    const path = normalizeNextcloudPath(input.path);
    await ctx.client.mkdir(path, input.parents ?? false);
    return toolJson({ created: true, path });
  },
});
