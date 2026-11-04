/**
 * dsh-host-notifier — a minimal HOST-side notification pusher for DSH 0.2.x.
 *
 * Why a host plugin: a browser-side notifier can only fire while its page is
 * alive. This row observes the Host's own session event stream and pushes to an
 * external channel, so completion / error / needs-answer notifications still
 * arrive when the tab is frozen, closed, the laptop sleeps, or the SSH tunnel
 * drops.
 *
 * Observed seams (all Host-side, no client involvement):
 *   - `session/event` `turn/end`        → completed / error
 *   - `session/event` `tool/call`       → ask_user_question (needs an answer)
 *   - `session/event` `tool/ptc-dispatch` → ask_user_question in PTC mode
 *   - `session/event` `approval/asked`  → approval needed
 *   - `session/event` `session/title`   → keeps the notification title current
 *
 * Only Node builtins are imported: this file is loaded directly by the Host's
 * tsx loader, so it must not depend on this checkout's package graph.
 *
 * @module dsh-host-notifier
 */

import { createHmac } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** Resolve optional peers (undici) from this plugin's own directory. */
const nodeRequire = createRequire(import.meta.url)

/** Notifiable event classes. */
type EventKind = 'completed' | 'error' | 'question' | 'approval'

interface ChannelBase {
  readonly enabled?: boolean
  /** Restrict this channel to a subset of {@link EventKind}. */
  readonly events?: readonly EventKind[]
}

interface NtfyChannel extends ChannelBase {
  readonly type: 'ntfy'
  /** Base server; defaults to https://ntfy.sh */
  readonly url?: string
  readonly topic: string
  /** Optional bearer access token for protected topics. */
  readonly token?: string
}

interface BarkChannel extends ChannelBase {
  readonly type: 'bark'
  readonly key: string
  /** Base server; defaults to https://api.day.app */
  readonly server?: string
}

interface TelegramChannel extends ChannelBase {
  readonly type: 'telegram'
  readonly botToken: string
  readonly chatId: string
}

interface WebhookChannel extends ChannelBase {
  readonly type: 'webhook'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

/** ServerChan (Server酱) — WeChat push, reachable from mainland networks. */
interface ServerChanChannel extends ChannelBase {
  readonly type: 'serverchan'
  readonly sendKey: string
  /** Base server; defaults to https://sctapi.ftqq.com */
  readonly server?: string
}

/** DingTalk (钉钉) group robot — text message, optional HMAC sign. */
interface DingTalkChannel extends ChannelBase {
  readonly type: 'dingtalk'
  readonly url: string
  readonly secret?: string
}

/** Feishu (飞书) group robot — text message, optional HMAC sign. */
interface FeishuChannel extends ChannelBase {
  readonly type: 'feishu'
  readonly url: string
  readonly secret?: string
}

interface LogChannel extends ChannelBase {
  readonly type: 'log'
}

type Channel =
  | NtfyChannel
  | BarkChannel
  | TelegramChannel
  | WebhookChannel
  | ServerChanChannel
  | DingTalkChannel
  | FeishuChannel
  | LogChannel

/** Plugin configuration (the Cordis row's `config`). */
export interface Config {
  /** Delivery targets. Empty keeps the plugin in log-only mode. */
  readonly channels?: readonly Channel[]
  /** Event classes this plugin may emit; defaults to all four. */
  readonly events?: readonly EventKind[]
  /** Include subagent sessions; defaults to false. */
  readonly includeSubagents?: boolean
  /** Log instead of sending (safe first run); defaults to false. */
  readonly logOnly?: boolean
  /**
   * HTTP(S) proxy for outbound delivery only, for example
   * `http://127.0.0.1:17890`. Requires the `undici` package installed beside
   * this file; other Host traffic (models, tools) is unaffected.
   */
  readonly proxy?: string
  /** Per-request timeout; defaults to 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional trace file. When set, activation and every notification attempt
   * append one line, which lets a deployment verify the row is live even when
   * the Host log is not readable.
   */
  readonly debugFile?: string
}

const DEFAULT_EVENTS: readonly EventKind[] = ['completed', 'error', 'question', 'approval']
const DEFAULT_TIMEOUT_MS = 5_000

interface SessionLike {
  readonly id: string
  readonly header: { readonly cwd?: string; readonly origin?: string }
}

interface SessionEventLike {
  readonly type: string
  readonly time?: number
  readonly data?: any
}

interface ContextLike {
  on(event: string, listener: (...args: any[]) => unknown): () => unknown
  effect(factory: () => () => void, label?: string): unknown
  logger?: {
    info?(...args: unknown[]): void
    warn(...args: unknown[]): void
  }
}

interface Message {
  readonly kind: EventKind
  readonly title: string
  readonly text: string
  readonly sessionId: string
  readonly cwd: string | undefined
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-host-notifier'

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeEvents(value: unknown): readonly EventKind[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_EVENTS
  const allowed = new Set<EventKind>(DEFAULT_EVENTS)
  const picked = value.filter((item): item is EventKind => typeof item === 'string' && allowed.has(item as EventKind))
  return picked.length === 0 ? DEFAULT_EVENTS : picked
}

function envChannels(): unknown {
  const raw = process.env.DSH_NOTIFY_CHANNELS
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.warn('[host-notifier] DSH_NOTIFY_CHANNELS is not valid JSON; ignoring it', error)
    return undefined
  }
}

function normalizeChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return []
  const channels: Channel[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (item.enabled === false) continue
    switch (item.type) {
      case 'ntfy': {
        if (typeof item.topic !== 'string' || item.topic === '') {
          console.warn('[host-notifier] ntfy channel skipped: `topic` is required')
          break
        }
        channels.push({
          type: 'ntfy',
          topic: item.topic,
          ...typeof item.url === 'string' && item.url !== '' ? { url: item.url } : {},
          ...typeof item.token === 'string' && item.token !== '' ? { token: item.token } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'bark': {
        if (typeof item.key !== 'string' || item.key === '') {
          console.warn('[host-notifier] bark channel skipped: `key` is required')
          break
        }
        channels.push({
          type: 'bark',
          key: item.key,
          ...typeof item.server === 'string' && item.server !== '' ? { server: item.server } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'telegram': {
        if (typeof item.botToken !== 'string' || item.botToken === ''
          || typeof item.chatId !== 'string' || item.chatId === '') {
          console.warn('[host-notifier] telegram channel skipped: `botToken` and `chatId` are required')
          break
        }
        channels.push({
          type: 'telegram',
          botToken: item.botToken,
          chatId: item.chatId,
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'serverchan': {
        if (typeof item.sendKey !== 'string' || item.sendKey === '') {
          console.warn('[host-notifier] serverchan channel skipped: `sendKey` is required')
          break
        }
        channels.push({
          type: 'serverchan',
          sendKey: item.sendKey,
          ...typeof item.server === 'string' && item.server !== '' ? { server: item.server } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'dingtalk': {
        if (typeof item.url !== 'string' || item.url === '') {
          console.warn('[host-notifier] dingtalk channel skipped: `url` is required')
          break
        }
        channels.push({
          type: 'dingtalk',
          url: item.url,
          ...typeof item.secret === 'string' && item.secret !== '' ? { secret: item.secret } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'feishu': {
        if (typeof item.url !== 'string' || item.url === '') {
          console.warn('[host-notifier] feishu channel skipped: `url` is required')
          break
        }
        channels.push({
          type: 'feishu',
          url: item.url,
          ...typeof item.secret === 'string' && item.secret !== '' ? { secret: item.secret } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'webhook': {
        if (typeof item.url !== 'string' || item.url === '') {
          console.warn('[host-notifier] webhook channel skipped: `url` is required')
          break
        }
        channels.push({
          type: 'webhook',
          url: item.url,
          ...isRecord(item.headers) ? { headers: item.headers as Record<string, string> } : {},
          ...normalizeEvents(item.events) === DEFAULT_EVENTS ? {} : { events: normalizeEvents(item.events) },
        })
        break
      }
      case 'log':
        channels.push({ type: 'log' })
        break
      default:
        console.warn(`[host-notifier] unknown channel type ${JSON.stringify(item.type)}; skipped`)
    }
  }
  return channels
}

/** Best-effort one-line summary of an `ask_user_question` call. */
function questionSummary(data: unknown): string {
  if (!isRecord(data)) return 'waiting for your answer'
  const args = typeof data.arguments === 'string'
    ? (() => { try { return JSON.parse(data.arguments) } catch { return undefined } })()
    : data.arguments
  if (!isRecord(args) || !Array.isArray(args.questions)) return 'waiting for your answer'
  const first = args.questions.find(isRecord)
  if (first === undefined || typeof first.question !== 'string') return 'waiting for your answer'
  return first.question.length > 200 ? `${first.question.slice(0, 197)}...` : first.question
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}

function sessionLabel(session: SessionLike, title: string | undefined): string {
  if (title !== undefined && title !== '') return title
  const cwd = session.header.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    const parts = cwd.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? shortId(session.id)
  }
  return shortId(session.id)
}

function displayKind(kind: EventKind): string {
  switch (kind) {
    case 'completed': return '会话完成'
    case 'error': return '会话出错'
    case 'question': return '需要你回答'
    case 'approval': return '需要你审批'
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

async function deliver(
  channel: Channel,
  message: Message,
  timeoutMs: number,
  doFetch: FetchLike,
): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs)
  switch (channel.type) {
    case 'ntfy': {
      const base = (channel.url ?? 'https://ntfy.sh').replace(/\/+$/, '')
      const response = await doFetch(`${base}/${encodeURIComponent(channel.topic)}`, {
        method: 'POST',
        headers: {
          'Title': message.title,
          'Tags': 'robot',
          ...channel.token === undefined ? {} : { 'Authorization': `Bearer ${channel.token}` },
        },
        body: message.text,
        signal,
      })
      if (!response.ok) throw new Error(`ntfy HTTP ${String(response.status)}`)
      return
    }
    case 'bark': {
      const base = (channel.server ?? 'https://api.day.app').replace(/\/+$/, '')
      const response = await doFetch(`${base}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_key: channel.key, title: message.title, body: message.text, group: 'DSH' }),
        signal,
      })
      if (!response.ok) throw new Error(`bark HTTP ${String(response.status)}`)
      return
    }
    case 'telegram': {
      const response = await doFetch(`https://api.telegram.org/bot${channel.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel.chatId,
          text: `${message.title}\n${message.text}`,
          disable_web_page_preview: true,
        }),
        signal,
      })
      if (!response.ok) throw new Error(`telegram HTTP ${String(response.status)}`)
      const payload: unknown = await response.json().catch(() => undefined)
      if (isRecord(payload) && payload.ok === false) {
        throw new Error(`telegram ${String(payload.error_code ?? '')}: ${String(payload.description ?? 'ok:false')}`)
      }
      return
    }
    case 'webhook': {
      const response = await doFetch(channel.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...channel.headers ?? {} },
        body: JSON.stringify({
          kind: message.kind,
          title: message.title,
          text: message.text,
          sessionId: message.sessionId,
          cwd: message.cwd,
          time: Date.now(),
        }),
        signal,
      })
      if (!response.ok) throw new Error(`webhook HTTP ${String(response.status)}`)
      return
    }
    case 'serverchan': {
      const base = (channel.server ?? 'https://sctapi.ftqq.com').replace(/\/+$/, '')
      const response = await doFetch(`${base}/${encodeURIComponent(channel.sendKey)}.send`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: message.title, desp: message.text }),
        signal,
      })
      if (!response.ok) throw new Error(`serverchan HTTP ${String(response.status)}`)
      const payload: unknown = await response.json().catch(() => undefined)
      if (isRecord(payload) && typeof payload.code === 'number' && payload.code !== 0) {
        throw new Error(`serverchan code ${String(payload.code)}: ${String(payload.message ?? '')}`)
      }
      return
    }
    case 'dingtalk': {
      let target = channel.url
      if (channel.secret !== undefined) {
        const timestamp = String(Date.now())
        const sign = createHmac('sha256', channel.secret)
          .update(`${timestamp}\n${channel.secret}`)
          .digest('base64')
        const url = new URL(target)
        url.searchParams.set('timestamp', timestamp)
        url.searchParams.set('sign', sign)
        target = url.toString()
      }
      const response = await doFetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: { content: `${message.title}\n${message.text}` },
        }),
        signal,
      })
      if (!response.ok) throw new Error(`dingtalk HTTP ${String(response.status)}`)
      const payload: unknown = await response.json().catch(() => undefined)
      if (isRecord(payload) && typeof payload.errcode === 'number' && payload.errcode !== 0) {
        throw new Error(`dingtalk errcode ${String(payload.errcode)}: ${String(payload.errmsg ?? '')}`)
      }
      return
    }
    case 'feishu': {
      const body: Record<string, unknown> = {
        msg_type: 'text',
        content: { text: `${message.title}\n${message.text}` },
      }
      if (channel.secret !== undefined) {
        const timestamp = String(Math.floor(Date.now() / 1000))
        body.timestamp = timestamp
        // Feishu signs with the "timestamp\nsecret" string as the HMAC key and an empty message.
        body.sign = createHmac('sha256', `${timestamp}\n${channel.secret}`).update('').digest('base64')
      }
      const response = await doFetch(channel.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok) throw new Error(`feishu HTTP ${String(response.status)}`)
      const payload: unknown = await response.json().catch(() => undefined)
      if (isRecord(payload) && typeof payload.code === 'number' && payload.code !== 0) {
        throw new Error(`feishu code ${String(payload.code)}: ${String(payload.msg ?? '')}`)
      }
      return
    }
    case 'log':
      console.log(`[host-notifier] ${message.kind} · ${message.title} · ${message.text}`)
      return
  }
}

/**
 * Register the Host-side listeners.
 * @param ctx - Host Cordis context (structural view).
 * @param rawConfig - row configuration (see {@link Config}).
 */
export function apply(ctx: ContextLike, rawConfig: Config = {}): void {
  const events = normalizeEvents(rawConfig.events)
  const includeSubagents = rawConfig.includeSubagents === true
  const logOnly = rawConfig.logOnly === true
  const timeoutMs = typeof rawConfig.timeoutMs === 'number' && rawConfig.timeoutMs > 0
    ? rawConfig.timeoutMs
    : DEFAULT_TIMEOUT_MS
  const channels = normalizeChannels(rawConfig.channels ?? envChannels())
  const deliveryChannels: Channel[] = logOnly ? [{ type: 'log' }] : channels
  if (deliveryChannels.length === 0) {
    ctx.logger?.warn('[host-notifier] no channels configured; notifications will be logged only')
    deliveryChannels.push({ type: 'log' })
  }
  const titles = new Map<string, string>()
  const debugFile = typeof rawConfig.debugFile === 'string' && rawConfig.debugFile !== ''
    ? rawConfig.debugFile
    : undefined
  const record = (line: string): void => {
    if (debugFile === undefined) return
    try {
      appendFileSync(debugFile, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // A trace file is diagnostic only; never let it affect delivery.
    }
  }
  const log = (message: string): void => {
    if (ctx.logger?.info !== undefined) ctx.logger.info(message)
    else console.log(message)
  }
  const proxy = typeof rawConfig.proxy === 'string' && rawConfig.proxy !== '' ? rawConfig.proxy : undefined
  let doFetch: FetchLike = (url, init) => globalThis.fetch(url, init)
  if (proxy !== undefined) {
    try {
      const undici = nodeRequire('undici') as {
        fetch: (url: string, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>
        ProxyAgent: new (proxy: string) => unknown
      }
      const dispatcher = new undici.ProxyAgent(proxy)
      doFetch = (url, init) => undici.fetch(url, { ...init, dispatcher })
      log(`[host-notifier] proxy: ${proxy}`)
      record(`proxy ${proxy}`)
    } catch (error) {
      ctx.logger?.warn(`[host-notifier] proxy requested but undici is unavailable; sending directly: ${String(error)}`)
      record(`proxy-unavailable ${String(error)}`)
    }
  }
  const active = `[host-notifier] active: events=${events.join(',')} channels=${deliveryChannels.map(c => c.type).join(',')}`
  log(active)
  record(active)

  const notify = (kind: EventKind, session: SessionLike, detail: string): void => {
    if (!events.includes(kind)) return
    if (!includeSubagents && session.header.origin === 'subagent') return
    const cwd = typeof session.header.cwd === 'string' ? session.header.cwd : undefined
    const title = `DSH · ${sessionLabel(session, titles.get(session.id))}`
    const text = `${displayKind(kind)}${detail === '' ? '' : ` · ${detail}`}${cwd === undefined ? '' : `\n${cwd}`}\n${shortId(session.id)}`
    const message: Message = { kind, title, text, sessionId: session.id, cwd }
    record(`${kind} ${session.id} ${text.replace(/\n/g, ' | ')}`)
    const targets = deliveryChannels.filter(channel => channel.events === undefined || channel.events.includes(kind))
    for (const channel of targets) {
      void deliver(channel, message, timeoutMs, doFetch).catch((error: unknown) => {
        record(`delivery-failed ${channel.type}: ${String(error)}`)
        ctx.logger?.warn(`[host-notifier] ${channel.type} delivery failed: ${String(error)}`)
      })
    }
  }

  ctx.effect(() => {
    const off = ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
      if (event.type === 'session/title') {
        const title = event.data?.title
        if (typeof title === 'string' && title !== '') titles.set(session.id, title)
        return
      }
      if (event.type === 'turn/end') {
        const reason = event.data?.reason
        const reasonKind = isRecord(reason) && typeof reason.kind === 'string' ? reason.kind : 'completed'
        if (reasonKind === 'completed') notify('completed', session, '')
        else notify('error', session, `turn ended: ${reasonKind}`)
        return
      }
      if (event.type === 'approval/asked') {
        const tool = event.data?.toolName
        notify('approval', session, typeof tool === 'string' ? tool : '')
        return
      }
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') {
        if (event.data?.name !== 'ask_user_question') return
        notify('question', session, questionSummary(event.data))
      }
    })
    return () => { off() }
  }, 'dsh-host-notifier: session events')
}
