# dsh-host-notifier

A minimal **Host-side** notification pusher for DeepSeek Harness `0.2.x`.

It runs inside the `dsh web` Host (not the browser page), observes the Host's own
session events, and pushes to an external channel. Because it never depends on a
browser tab, notifications still arrive when the tab is frozen or closed, the
laptop sleeps, or the SSH tunnel drops.

- Source: [`index.ts`](./index.ts) — single file, Node builtins only
  (`node:crypto`, `node:fs`, `node:module`, `node:os`); nothing from this checkout.
- Wiring: inserted by `~/.dsh/profiles/web/cordis.patch.yml` as a `file://` plugin row.
- Events: `turn/end` (completed / error), `ask_user_question` (question), `approval/asked` (approval).
- Channels: `ntfy`, `bark`, `telegram`, `webhook`, `log`.

## Current state

Installed with `logOnly: true`: the plugin logs each notification to the
`dsh-web` Host log and sends nothing. This is the safe first run — verify the
wiring in the log, then configure one channel.

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

Edit `~/.dsh/profiles/web/cordis.patch.yml`, find the `dsh-host-notifier` row, and
uncomment one channel. Then set `logOnly: false` and restart the Host
(`systemctl --user restart dsh-web`).

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

This uses the `undici` package installed beside `index.ts` (`npm install undici`
in this directory). Without it, the plugin logs `proxy-unavailable` and falls
back to a direct request.

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

Set `debugFile: /tmp/dsh-host-notifier.debug` temporarily (it is off in the
installed row) to make activation and every notification attempt append one line
even when the Host log is not readable:

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

## Notes

- Subagent sessions are skipped unless `includeSubagents: true`.
- A non-`completed` turn end (aborted, error, token limit) is reported as `error`
  with the reason in the body.
- The row is host-only: it adds no client bundle, no tools, and no model-visible
  surface.
