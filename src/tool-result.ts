import type { CallToolResult } from "@modelcontextprotocol/server";
import { ZodError } from "zod/v4";
import { FileTooLargeError, NextcloudError, PathError, UserInputError } from "./errors.js";

export type ToolResult = CallToolResult;

export function toolJson(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function toolFail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function toolError(error: unknown): ToolResult {
  if (
    error instanceof PathError ||
    error instanceof UserInputError ||
    error instanceof FileTooLargeError ||
    error instanceof NextcloudError
  ) {
    return toolFail(error.message);
  }
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => {
        const path = issue.path.map((part) => String(part)).join(".");
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    return toolFail(`Invalid arguments: ${details}`);
  }
  if (error instanceof Error) {
    console.error(error);
    return toolFail(error.message);
  }
  console.error(error);
  return toolFail("Unexpected Nextcloud MCP error.");
}
