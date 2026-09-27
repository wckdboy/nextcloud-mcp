import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { isLoopbackHost, type NextcloudConfig } from "./config.js";
import { createNextcloudMcpServer } from "./server.js";
import type { NextcloudFiles } from "./nextcloud/types.js";

export function createHttpServer(config: NextcloudConfig, client: NextcloudFiles): Server {
  const handler = createMcpHandler(() => createNextcloudMcpServer(client, config.limits));
  const nodeHandler = toNodeHandler(handler);
  const loopback = isLoopbackHost(config.httpHost);
  const validateHost = loopback ? localhostHostValidation() : hostHeaderValidation([...config.httpAllowedHosts]);
  const validateOrigin = loopback ? localhostOriginValidation() : originValidation([...config.httpAllowedHosts]);

  return createServer((req, res) => {
    if (!authorize(req, res, config.httpToken)) {
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) {
      return;
    }
    const pathname = requestPath(req);
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, name: "nextcloud-mcp" }));
      return;
    }
    void nodeHandler(req, res);
  });
}

export function startHttpServer(config: NextcloudConfig, client: NextcloudFiles): Promise<void> {
  const server = createHttpServer(config, client);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, config.httpHost, () => {
      console.error(
        `nextcloud-mcp Streamable HTTP on http://${formatHost(config.httpHost)}:${config.httpPort}/mcp`,
      );
      resolve();
    });
  });
}

function authorize(req: IncomingMessage, res: ServerResponse, token: string | null): boolean {
  if (!token) {
    return true;
  }
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!bearerMatches(header, token)) {
    res.writeHead(401, { "WWW-Authenticate": "Bearer", "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unauthorized");
    return false;
  }
  return true;
}

function bearerMatches(header: string, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

function requestPath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  try {
    return new URL(raw, "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
