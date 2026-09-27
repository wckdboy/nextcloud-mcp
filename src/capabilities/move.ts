import * as z from "zod/v4";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  from: z.string().describe("Existing file or folder path, relative to the files root."),
  to: z.string().describe("New path, relative to the files root. This is a move, not a copy."),
  overwrite: z.boolean().optional().describe("Replace the destination if it exists. Default false."),
});

export const move = defineCapability({
  name: "move",
  title: "Move or rename",
  description:
    "Move or rename a file or folder with WebDAV MOVE. overwrite defaults to false. Refuses to move the files root or a folder into itself.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async handle(input, ctx) {
    const from = normalizeNextcloudPath(input.from);
    const to = normalizeNextcloudPath(input.to);
    const overwrite = input.overwrite ?? false;
    await ctx.client.move(from, to, overwrite);
    return toolJson({ from, to, overwrite });
  },
});
