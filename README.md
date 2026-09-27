# nextcloud-mcp

MCP server for one Nextcloud account. Agents list, read, write, upload, download, create, move, and delete files over WebDAV, create public share links over the OCS Share API, and search file names with WebDAV SEARCH. File bytes travel over WebDAV. Large files already on the MCP host use `upload_file` and `download_file` with an absolute `localPath` instead of base64 in the tool call. Credentials stay in environment variables. This repository does not ship secrets.

Nextcloud auth is HTTP Basic with the user id and an **app password** (an app token). The server does not use browser login, session cookies, or Login Flow v2/OAuth.

## Protocols

| Work | Protocol | Endpoint |
| --- | --- | --- |
| List, stat, read, write, upload, download, mkdir, move, delete | WebDAV | `/remote.php/dav/files/<username>/…` |
| Filename search | WebDAV `SEARCH` | `/remote.php/dav/` |
| Public share link | OCS Share API | `/ocs/v2.php/apps/files_sharing/api/v1/shares` |

OCS is used only for share links, which WebDAV does not create. File bytes and folders never go through the browser or the OCS files API. `delete` requires `confirm: true` (and `recursive: true` for a folder). Paths that contain `..` are rejected before any request.

CI runs mocked WebDAV and OCS responses. It does not call a live Nextcloud, so a LAN-only instance is fine.

The server speaks [stdio](https://modelcontextprotocol.io) for Cursor and Grok Bot, and optional Streamable HTTP (JSON, with SSE when a response streams) for a remote client.

## Tools

| Tool | What it does |
| --- | --- |
| `list_directory` | Immediate children of a folder. Not recursive. |
| `stat` | Metadata for one file or folder (file info). |
| `read_file` | UTF-8 text, or base64 when you ask. Refuses binary text and files over the read limit. |
| `download_file` | WebDAV GET into an absolute `localPath` on the MCP host. Does not return bytes. Ceiling is `NEXTCLOUD_MAX_WRITE_BYTES`. Oversized files are refused, not truncated. |
| `write_file` | Small inline upload (UTF-8 or base64). Refuses to replace an existing file unless `overwrite` is true. For a large or binary file on the host, prefer `upload_file` with `localPath`. |
| `upload_file` | Read an absolute `localPath` on the MCP host and WebDAV PUT it. No inline content and no base64. Size is checked with `stat` against `NEXTCLOUD_MAX_WRITE_BYTES` before upload. |
| `mkdir` | Create a folder. `parents: true` creates missing ancestors. |
| `move` | Move or rename. `overwrite` defaults to false. |
| `delete` | Delete one path. Requires `confirm: true`. A folder also requires `recursive: true`. |
| `create_share_link` | Public link (OCS `shareType` 3). Default permission is read. |
| `search` | Filename substring via WebDAV SEARCH. Not full-text content search. |

Paths are relative to the signed-in user's files. `""` and `"/"` are the files root. `..`, encoded `..`, backslashes, and URLs are rejected.

`delete` never removes the files root. There is no multi-path delete and no account wipe. Nextcloud's own `DELETE` on a folder removes that folder's contents, so a folder delete stays gated behind `recursive: true`.

`write_file`, `upload_file`, and `mkdir` accept `parents: true` to create missing parent folders. They do not delete anything to do it.

`localPath` is on the computer running this MCP process (the Cursor host, or the Grok Bot computer, for stdio). It is not a Nextcloud path. `upload_file` and `download_file` refuse a relative path, any `..` segment, and a path Node cannot resolve. `download_file` also refuses a symlink at the destination file and leaves no partial file behind when the download is refused. A remote HTTP deployment reads and writes files on that server, not on a different laptop.

## Grok Bot / Cursor plugin

<img src="assets/logo.png" alt="Community plugin icon" width="96" />

This is a community MCP for Nextcloud files. It is not a first-party Nextcloud or Cursor product.

Install **Nextcloud** from the marketplace once this repository is listed. In Cursor that is Customize. In Grok Bot that is SearchPlugins. The plugin starts the same stdio server as the `nextcloud-mcp` npm bin (`npx` runs `github:wckdboy/nextcloud-mcp`). Fill the three setup variables in the plugin configuration. Do not add a second custom MCP server for the same account.

| Variable | What to enter |
| --- | --- |
| `NEXTCLOUD_URL` | Instance base URL, no trailing slash. Example: `https://cloud.example.com`. |
| `NEXTCLOUD_USERNAME` | Nextcloud user id. |
| `NEXTCLOUD_APP_PASSWORD` | App token from Settings → Security → Devices & sessions. Not the account password. |

The plugin stores only `${NEXTCLOUD_URL}`, `${NEXTCLOUD_USERNAME}`, and `${NEXTCLOUD_APP_PASSWORD}` placeholders. Values stay in the host configuration.

Tools, once those variables are set:

- `list_directory` and `stat` to inspect a folder or one path
- `read_file` and `write_file` for small inline file contents
- `upload_file` and `download_file` when the bytes are already on the MCP host (`localPath`)
- `mkdir` and `move` to create folders and rename or move
- `delete` with `confirm: true` (and `recursive: true` for a folder)
- `search` for a filename substring
- `create_share_link` for a public OCS link

Details are in [Tools](#tools). `skills/nextcloud-files/SKILL.md` is the same guidance for the agent. Auth is the app token already configured on the server. The server does not start Login Flow v2.

Before the listing is public, test the plugin from a clone:

```bash
git clone https://github.com/wckdboy/nextcloud-mcp.git ~/.cursor/plugins/local/nextcloud-mcp
```

Reload the window, then install **Nextcloud** from Customize. A symlink in `~/.cursor/plugins/local` that points outside that folder is ignored, so clone or copy the repo into that directory.

After this change is on `main`, submit the repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Cursor reviews the listing before it appears in Customize and SearchPlugins. Pinning the repo in the Grok Build catalog is a separate step.

## Requirements

- Node.js 20 or newer
- A Nextcloud account and an app password

## Install and run locally

```bash
git clone https://github.com/wckdboy/nextcloud-mcp.git
cd nextcloud-mcp
npm ci
npm run build
cp .env.example .env
# edit .env — see below
npm run mcp
```

`npm run mcp` and `npm start` are the stdio server (`node dist/index.js`). A `.env` file in the working directory is loaded for local runs and does not override variables that are already set. MCP hosts should pass the variables themselves.

Check the project without a Nextcloud server:

```bash
npm run typecheck
npm test
npm run build
```

`npm test` uses mocked WebDAV and OCS responses.

## Environment

Required:

| Name | Example | Purpose |
| --- | --- | --- |
| `NEXTCLOUD_URL` | `https://cloud.example.com` | Base URL. A trailing slash is removed. No user, password, query, or fragment. |
| `NEXTCLOUD_USERNAME` | `ada` | Nextcloud user id. |
| `NEXTCLOUD_APP_PASSWORD` | *(app token)* | App password from Settings → Security → Devices & sessions. Not the account password. |

Optional:

| Name | Default | Purpose |
| --- | --- | --- |
| `NEXTCLOUD_MAX_READ_BYTES` | `1048576` | Inline `read_file` ceiling. Hard max `8388608` (8 MiB). Oversized files are refused, not truncated. |
| `NEXTCLOUD_MAX_WRITE_BYTES` | `10485760` | Upload ceiling for `write_file` and `upload_file`, and the download-to-disk ceiling for `download_file`. Hard max `33554432` (32 MiB). Oversized transfers are refused, not truncated. |
| `NEXTCLOUD_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address for `--http`. |
| `MCP_HTTP_PORT` | `8787` | Bind port for `--http`. |
| `MCP_HTTP_TOKEN` | unset | If set, HTTP requests must send `Authorization: Bearer <token>`. Required when the bind address is not loopback. |
| `MCP_HTTP_ALLOWED_HOSTS` | unset | Comma-separated `Host` names. Required when the bind address is not loopback. |

Copy [`.env.example`](.env.example). Do not commit `.env`.

If any of the three required variables is missing, the process exits before it listens. The error names the missing variables and does not ask for a password.

## Authentication

Every WebDAV call (`/remote.php/dav/files/<user>/…`) and every OCS call sends:

```http
Authorization: Basic base64(NEXTCLOUD_USERNAME:NEXTCLOUD_APP_PASSWORD)
```

`NEXTCLOUD_APP_PASSWORD` is the app token Nextcloud shows once when you create an app password. The server never reads a session cookie, never starts Login Flow v2, and never performs an OAuth login. Redirects are not followed, so a login page cannot become a session.

Do not paste the Nextcloud account password or the app token into chat. Put the app token in the MCP server environment as `NEXTCLOUD_APP_PASSWORD`. Agents should ask only for that secret name if it is unset.

## Create a Nextcloud app password

1. Sign in to Nextcloud in a browser.
2. Open the avatar menu and choose **Personal settings** (or **Settings**).
3. Open **Security**.
4. Find **Devices & sessions** (also labeled **App passwords** on some versions).
5. Type an app name such as `MCP`.
6. Choose **Create new app password**.
7. Copy that app token into `NEXTCLOUD_APP_PASSWORD`. Nextcloud shows it once. This is not your account password.
8. Set `NEXTCLOUD_USERNAME` to the account user id (the id used to sign in, not necessarily the display name).
9. Set `NEXTCLOUD_URL` to the site origin, for example `https://cloud.example.com`. If Nextcloud lives in a subdirectory, include it: `https://cloud.example.com/nextcloud`.

WebDAV is then `NEXTCLOUD_URL/remote.php/dav/files/NEXTCLOUD_USERNAME/`. Share links use `NEXTCLOUD_URL/ocs/v2.php/apps/files_sharing/api/v1/shares`. Both use the same Basic header.

## Cursor

The [plugin install](#grok-bot--cursor-plugin) is the path for Customize. The block below is a manual stdio server when you are not using the plugin.

Put this in the user file `~/.cursor/mcp.json`, or in the project file `.cursor/mcp.json` if that file is gitignored. Use an absolute path. Keep the password out of the repository.

```json
{
  "mcpServers": {
    "nextcloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/nextcloud-mcp/dist/index.js"],
      "env": {
        "NEXTCLOUD_URL": "https://cloud.example.com",
        "NEXTCLOUD_USERNAME": "your-user-id",
        "NEXTCLOUD_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

Secret names: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD`.

Reload MCP servers in Cursor after saving. The stdio process is how Cursor launches the server. A URL on your laptop is not required.

From a machine that can `npm install` this public repo, the same server can be started without a local clone:

```json
{
  "mcpServers": {
    "nextcloud": {
      "command": "npx",
      "args": ["-y", "--package", "github:wckdboy/nextcloud-mcp", "nextcloud-mcp"],
      "env": {
        "NEXTCLOUD_URL": "https://cloud.example.com",
        "NEXTCLOUD_USERNAME": "your-user-id",
        "NEXTCLOUD_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

`npm` runs `prepare`, which compiles TypeScript, then runs the `nextcloud-mcp` binary.

## Grok Bot

SearchPlugins installs the [Nextcloud plugin](#grok-bot--cursor-plugin) after it is listed. Until then, add a custom stdio server. Grok Bot runs that process on its cloud computer and cannot reach `localhost` on your laptop. Store the three secrets on that server entry.

In the bot chat:

```text
Add a custom MCP server called nextcloud that runs:
npx -y --package github:wckdboy/nextcloud-mcp nextcloud-mcp

Set these environment variables on the server entry. Store the values as secrets:
NEXTCLOUD_URL
NEXTCLOUD_USERNAME
NEXTCLOUD_APP_PASSWORD
```

Command: `npx`  
Args: `-y`, `--package`, `github:wckdboy/nextcloud-mcp`, `nextcloud-mcp`  
Secret names: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD`

Confirm when the bot repeats the command and the variable names. Store the app token as `NEXTCLOUD_APP_PASSWORD` on that server entry. Do not paste the Nextcloud account password or the app token into the chat. Attach the server with `@` if the bot does not pick it up on its own. A server saved only in Cursor's `mcp.json` is not automatically available in Grok Bot; add it there with the message above.

If the bot's computer already has a built checkout, use command `node` and args `/ABSOLUTE/PATH/nextcloud-mcp/dist/index.js` with the same three variables.

### Grok Build (terminal)

This is the `grok` CLI, not the Grok Bot chat UI. Either form uses the same secret names.

```bash
grok mcp add nextcloud -- \
  npx -y --package github:wckdboy/nextcloud-mcp nextcloud-mcp
```

Then set the variables in `~/.grok/config.toml` so the values can come from your environment:

```toml
[mcp_servers.nextcloud]
command = "npx"
args = ["-y", "--package", "github:wckdboy/nextcloud-mcp", "nextcloud-mcp"]
enabled = true

[mcp_servers.nextcloud.env]
NEXTCLOUD_URL = "${NEXTCLOUD_URL}"
NEXTCLOUD_USERNAME = "${NEXTCLOUD_USERNAME}"
NEXTCLOUD_APP_PASSWORD = "${NEXTCLOUD_APP_PASSWORD}"
```

`grok mcp doctor nextcloud` checks the process. Grok expands `${VAR}` when it loads the file.

### Grok on the web

Custom connectors at [grok.com/connectors](https://grok.com/connectors) need a public HTTPS MCP URL. The stdio command above is the one Grok Bot should run. The HTTP mode below is loopback unless you put it behind your own TLS proxy and set `MCP_HTTP_TOKEN`.

## Optional HTTP

```bash
npm run mcp:http
```

That is `node dist/index.js --http`. The MCP endpoint is `http://127.0.0.1:8787/mcp`. `GET /health` returns `{"ok":true,"name":"nextcloud-mcp"}` and no credentials.

The transport is Streamable HTTP: a normal JSON response, or an SSE stream when the session needs one. On loopback, `Host` and `Origin` are limited to localhost. Set `MCP_HTTP_TOKEN` to require `Authorization: Bearer <token>`.

Binding a non-loopback address also requires `MCP_HTTP_TOKEN` and `MCP_HTTP_ALLOWED_HOSTS` (the hostnames clients send in `Host`).

## Search limits

`search` sends a WebDAV `SEARCH` request (RFC 5323) to `/remote.php/dav/`, scoped to `files/<user>/<folder>` with depth `infinity`. The match is a substring of `displayname` (the file name). It does not search inside file contents. `%`, `_`, and `\` in the query are removed so they are not LIKE wildcards. Results default to 25 and cannot exceed 100. If the server returns HTTP 405 or 501, that instance does not allow WebDAV SEARCH.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # mocked WebDAV and OCS
npm run build       # dist/
npm run check       # typecheck and test
```

CI runs typecheck, test, and build on Node 22. No live Nextcloud.

## License

MIT
