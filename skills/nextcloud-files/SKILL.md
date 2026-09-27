---
name: nextcloud-files
description: Use the Nextcloud file tools for the signed-in user's files. Covers list, stat, read, write, host-path upload and download, mkdir, move, delete, filename search, and public share links. Use when the user asks to browse, change, or share files on their Nextcloud. Auth is an app token already set on the server.
---

# Nextcloud files

Paths are relative to the signed-in user's files. `""` and `"/"` are the files root. Reject `..`, encoded `..`, backslashes, and URLs before calling a tool.

The server already authenticates with HTTP Basic using `NEXTCLOUD_USERNAME` and an app token (`NEXTCLOUD_APP_PASSWORD` from Settings → Security → Devices & sessions). Do not ask for the Nextcloud account password or the app token. Do not start Login Flow v2, OAuth, or a browser login. Do not put secrets in tool arguments except the optional share-link password.

## Which tool

| Need | Tool |
| --- | --- |
| Immediate children of a folder | `list_directory` (not recursive) |
| Metadata for one file or folder | `stat` |
| Small text, or a small binary as base64 | `read_file` (UTF-8 text; `encoding: "base64"` for binary) and `write_file` |
| Large or binary file already on the MCP host | `upload_file` (`path`, absolute `localPath`; WebDAV PUT; no base64) |
| Save a Nextcloud file onto the MCP host | `download_file` (`path`, absolute `localPath`; WebDAV GET; no base64 in the result) |
| Create a folder | `mkdir` |
| Rename or move | `move` (`from`, `to`; this is not a copy) |
| Remove one path | `delete` |
| Find a file by name | `search` (filename substring only, not file contents) |
| Public link | `create_share_link` (OCS share type 3) |

`write_file`, `upload_file`, and `move` refuse to replace an existing path unless `overwrite` is true. `write_file`, `upload_file`, and `mkdir` create missing parents only when `parents` is true. They do not delete anything to do that.

File bytes travel over WebDAV. `write_file` and `read_file` put those bytes in the tool arguments (UTF-8 or base64). That is a poor fit for a large PDF. When the file is on the same computer as the MCP process, use `upload_file` or `download_file`. `localPath` is an absolute path on that host, not a Nextcloud path. Those tools refuse a relative path, any `..` segment, and a path Node cannot resolve. `upload_file` checks the local file size against `NEXTCLOUD_MAX_WRITE_BYTES` before PUT. `download_file` uses that same ceiling and refuses an oversized file instead of truncating it. It refuses a symlink at the destination, and it refuses to replace a local file unless `overwrite` is true. Do not base64 a large host file into `write_file`.

## Delete

`delete` refuses unless `confirm` is true. A folder also requires `recursive: true`, because Nextcloud `DELETE` on a folder removes everything inside that one folder. The files root cannot be deleted. There is no multi-path delete and no account wipe.

## Share links

`create_share_link` defaults to read permission (`1`). Do not share the files root. The result includes the URL and the permissions the server stored. It does not echo a link password.
