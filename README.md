# dsh-host-notifier

A minimal **Host-side** notification pusher for DeepSeek Harness `0.2.x`.

It runs inside the `dsh web` Host (not the browser page), observes the Host's own
session events, and pushes to an external channel. Because it never depends on a
browser tab, notifications still arrive when the tab is frozen or closed, the
laptop sleeps, or the SSH tunnel drops.

- Source: [`index.ts`](./index.ts) — single file, Node builtins only
  (`node:crypto`, `node:fs`, `node:module`, `node:os`, `node:path`,
  `node:url`); nothing from the DSH checkout.
- Entry: `dist/index.js`, compiled from `index.ts` and committed. A package
  cannot ship TypeScript as its entry: Node refuses to strip types inside
  `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and an
  install from git or a tarball runs no build step. Run `npm run build` after
  editing `index.ts`; never edit `dist/` by hand.
- Bundle: [`cordis.patch.yml`](./cordis.patch.yml), declared by
  `package.json` → `dsh.bundle.patch`. That one file is the package's
  substance: it inserts the `dsh-host-notifier` row.
- Events: `turn/end` (completed / error), `ask_user_question` (question), `approval/asked` (approval).
- Channels: `ntfy`, `bark`, `telegram`, `serverchan`, `dingtalk`, `feishu`, `webhook`, `log`.

## Install

Install into a DSH profile with the standard plugin command, which forwards to
pnpm inside the profile directory:

```sh
dsh plugin --profile web add git+ssh://git@github.com/jingchangshi/dsh-host-notifier.git
```

Other accepted specs:

```sh
# a local checkout, copied and hard-linked into the profile
dsh plugin --profile web add file:/path/to/dsh-host-notifier
# a tarball
dsh plugin --profile web add ./dsh-host-notifier-1.0.0.tgz
# a registry name, once published
dsh plugin --profile web add dsh-host-notifier
```

A bare path (`add /path/to/dsh-host-notifier`, no `file:`) also works but is a
**different shape**: pnpm records a `link:` and symlinks the directory, so the
profile runs straight out of your checkout and no dependencies are installed.
Prefer the `file:` form (see [Local checkouts](#local-checkouts)).

The install does three things:

1. adds the package to `$DSH_HOME/profiles/<name>/package.json` dependencies
   and installs it (with `undici`, its one dependency) into that profile's
   `node_modules`;
2. appends it to that manifest's `dsh.profile.bundles`, so its patch becomes a
   layer of the composition;
3. recomposes, so the new row starts — no restart on a live profile.

The row lands with `logOnly: true`: it logs each notification and sends
nothing. A package without `dsh.bundle.patch` is refused as `not-a-bundle`,
so this package can only be installed as a bundle.

Verify the row exists in the composed tree:

```sh
dsh --profile web --dump-config | grep -A4 dsh-host-notifier
```

```yaml
# == dsh-host-notifier
- id: dsh-host-notifier
  name: dsh-host-notifier
  config:
    logOnly: true
```

### Note on `undici`

`undici` is a real dependency, so every install shape that resolves
dependencies brings it automatically; that is what makes the `proxy` option
work. That covers a registry name, a tarball, a git URL, and `file:` local path
installs.

A bare-path install records a `link:` and installs no dependencies, so there
the plugin also asks the profile directory for `undici`. If neither place has
it — or if you configured a `proxy` that `undici` rejects — delivery falls back
to a direct request and the Host log says which of the two happened:

```text
# the package is missing
[host-notifier] proxy requested but undici is unavailable; sending directly: …

# the package loaded, but the proxy value is unusable
[host-notifier] invalid proxy "not a url": undici loaded but ProxyAgent rejected it; sending directly: …
```

Either way notifications still go out — but on a host where direct delivery
cannot work (Telegram behind the GFW), a *proxy* failure means they will not
arrive, so treat the second message as a configuration error to fix.

## Current state

Start with `logOnly: true`: the plugin then logs each notification to the
`dsh-web` Host log and sends nothing. Verify the wiring in the log, configure one
channel, and set `logOnly: false`.

## Notification format

Title: `[<server>] DSH · <session title or cwd basename>`.

The body is the kind (`会话完成`, `会话出错`, `需要你回答`, `需要你审批`, plus a
detail such as the question or tool name), the working directory (omitted when
unknown), and an identity line
`[user@]host:port[ · publicURL] · <short session id>` — two lines when the cwd is
unknown. A completed turn on `tbe`:

```text
[tbe:13063] DSH · proj
会话完成
/home/u/proj
s00653124@tbe:13063 · ses_abc12345…
```

When the Host advertises a public Web GUI URL, the identity line carries it too:

```text
[tbe:13063] DSH · proj
会话完成
/home/u/proj
s00653124@tbe:13063 · https://dsh.example.com · ses_abc12345…
```

Several DSH hosts usually push to one channel, so every message names the server
it came from; without that, two hosts' `会话完成` are indistinguishable.

| Field | Source |
| --- | --- |
| `name` | `serverName` config, else `os.hostname()` |
| `user` | `os.userInfo().username` |
| `port` | Host listener port from `ctx.webServer`, else the URL's port |
| `url` | advertised Web GUI URL from `ctx.webApp`/`DSH_WEB_URL`, non-loopback only |

### Server identity

```yaml
        logOnly: false
        serverName: prod-a
        channels:
          - type: ntfy
            topic: your-secret-topic
```

`serverName` defaults to the OS hostname. Set it when hostnames are opaque
(`tbe`, container ids) so deployments can be told apart; the tag becomes
`prod-a:13063`, or just `prod-a` when no port is known (`[tbe] DSH · proj` on a
Host with no web services).

## Configure

Config lives in the profile's own layer, `$DSH_HOME/profiles/web/cordis.patch.yml`,
which is applied after every bundle layer and wins. Add a row that targets the
installed one by id:

```yaml
- id: dsh-host-notifier
  config:
    logOnly: false
    channels:
      - type: ntfy
        topic: your-secret-topic
```

A patch replaces the targeted row's whole `config`, so restate every field you
need. Config changes hot-apply on a live profile. **Code** changes do not:
reinstall the package and restart the Host.

### ntfy

```yaml
    logOnly: false
    channels:
      - type: ntfy
        url: https://ntfy.sh
        topic: your-secret-topic
        # token: tk_xxx   # only for protected topics
```

### Bark (iOS)

```yaml
    logOnly: false
    channels:
      - type: bark
        key: your-bark-key
        server: https://api.day.app
```

### Telegram

```yaml
    logOnly: false
    channels:
      - type: telegram
        botToken: "123456:ABC-DEF"
        chatId: "123456789"
```

On a mainland-China host, Telegram is unreachable directly; set `proxy` (below)
to a local HTTP proxy. The proxy applies to this plugin only — model and tool
traffic is unaffected.

### Proxy (delivery only)

```yaml
    logOnly: false
    proxy: http://127.0.0.1:17890
    channels:
      - type: telegram
        botToken: "123456:ABC-DEF"
        chatId: "123456789"
```

This uses the `undici` package that ships with this plugin as a dependency.
Without it, the plugin logs `proxy-unavailable` and falls back to a direct
request.

### ServerChan (Server酱, WeChat)

```yaml
    logOnly: false
    channels:
      - type: serverchan
        sendKey: SCT123456Txxxxxxxx
```

### DingTalk (钉钉) group robot

```yaml
    logOnly: false
    channels:
      - type: dingtalk
        url: https://oapi.dingtalk.com/robot/send?access_token=...
        # secret: SEC...        # optional, when the robot uses 加签
```

### Feishu (飞书) group robot

```yaml
    logOnly: false
    channels:
      - type: feishu
        url: https://open.feishu.cn/open-apis/bot/v2/hook/...
        # secret: xxxxxx        # optional, when the bot uses 签名校验
```

### Generic webhook

POSTs JSON `{ kind, title, text, sessionId, cwd, server: { name, user, url, port }, time }`.
`undefined` members are omitted from the JSON, so a host without a public URL or
a known port simply lacks `server.url` or `server.port`.

```yaml
    logOnly: false
    channels:
      - type: webhook
        url: https://example.com/dsh-hook
        headers:
          authorization: Bearer change-me
```

Multiple channels may be listed. Each channel may restrict itself:

```yaml
      - type: ntfy
        topic: your-topic
        events: [question, approval]   # only needs-attention events
```

## Alternative: channels from the environment

If `channels` is omitted, the plugin reads `DSH_NOTIFY_CHANNELS` as a JSON array
of the same objects. This keeps secrets out of the profile file — set it in the
Host's systemd unit instead:

```ini
Environment='DSH_NOTIFY_CHANNELS=[{"type":"ntfy","topic":"your-topic"}]'
```

## Verify

Set `debugFile: /tmp/dsh-host-notifier.debug` temporarily to make activation and
every notification attempt append one line even when the Host log is not
readable:

```sh
tail -f /tmp/dsh-host-notifier.debug
# 2026-11-04T01:51:31.699Z [host-notifier] active: server=tbe:13063 events=completed,error,question,approval channels=log
# 2026-11-04T01:52:03.120Z completed tbe:13063 ses_... 会话完成 | /path/to/cwd | s00653124@tbe:13063 · ses_...
```

The Host log (when readable) also shows:

```
[host-notifier] active: server=tbe:13063 events=completed,error,question,approval channels=log
[host-notifier] completed · [tbe:13063] DSH · <session title> · 会话完成
```

Remove `debugFile` once verified; the installed row keeps it off.

## Uninstall

```sh
dsh plugin --profile web remove dsh-host-notifier
```

That drops the dependency and the bundle selection together.

## Development

```sh
npm run build     # regenerate dist/index.js from index.ts
npm install       # only needed for the proxy path (undici) while testing by hand
```

`dist/index.js` is committed so a git install runs as-is. After editing
`index.ts`, rebuild and commit both files.

### Local checkouts

Installing your working copy with the `file:` form does **not** run the profile
out of that directory. pnpm copies the package files into the profile and
**hard-links** them — the installed `dist/index.js` is the same inode as yours,
with two link counts. That has consequences worth knowing before you debug:

| Action in the checkout | Visible to the installed profile? |
| --- | --- |
| edit a file in place (`node build.mjs` truncates and rewrites) | **yes** — same inode |
| replace it (`rm -rf dist && node build.mjs`, editor "safe write", `git checkout`) | **no** — the link breaks and the profile keeps the OLD bytes |
| add a file or package | **no** — not part of the install |

The failure mode is quiet: the Host restarts happily and keeps running the code
it already had, so a "fix that didn't work" may simply be an un-reinstalled
build. After changing code, the reliable move is:

```sh
npm run build
dsh plugin --profile web add file:/path/to/dsh-host-notifier   # re-link
# then restart the Host
```

`dsh plugin --profile web remove dsh-host-notifier` followed by a fresh `add`
does the same thing. A plain restart is **not** enough on its own.

## Notes

- Subagent sessions are skipped unless `includeSubagents: true`.
- A non-`completed` turn end (aborted, error, token limit) is reported as `error`
  with the reason in the body.
- The row is host-only: it adds no client bundle, no tools, and no model-visible
  surface.
- ntfy carries the title in an HTTP header, which is Latin-1 only: a non-Latin-1
  session title fails that channel, visible only in the Host log. Others use the UTF-8 body.
