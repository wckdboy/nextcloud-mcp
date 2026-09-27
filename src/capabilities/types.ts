import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Limits } from "../config.js";
import type { NextcloudFiles } from "../nextcloud/types.js";
import { toolError, type ToolResult } from "../tool-result.js";

export interface ToolContext {
  client: NextcloudFiles;
  limits: Limits;
}

export interface CapabilityAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Capability {
  name: string;
  title: string;
  description: string;
  register(server: McpServer, ctx: ToolContext): void;
  handle(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

const mcpInputSchema = z.object({ path: z.string() });
type McpInputSchema = typeof mcpInputSchema;

export function defineCapability<S extends z.ZodObject<z.ZodRawShape>>(definition: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: CapabilityAnnotations;
  handle: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}): Capability {
  const run = async (input: unknown, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const parsed = definition.inputSchema.parse(input);
      return await definition.handle(parsed, ctx);
    } catch (error) {
      return toolError(error);
    }
  };

  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    handle: run,
    register(server, ctx) {
      // registerTool only accepts a concrete Zod object, not the generic constraint.
      const inputSchema = definition.inputSchema as unknown as McpInputSchema;
      server.registerTool(
        definition.name,
        {
          title: definition.title,
          description: definition.description,
          inputSchema,
          annotations: definition.annotations,
        },
        async (args) => run(args, ctx),
      );
    },
  };
}
