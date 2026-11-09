// Generated from index.ts by build.mjs — do not edit. Run `node build.mjs` to refresh.
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
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The slice of `undici` the proxy path uses. */
                        
                                                                                         
                                            
 

/**
 * Load the optional `undici` package for the proxy path.
 *
 * Its normal home is this package's own `node_modules`, which every install that
 * resolves dependencies creates because `undici` is a declared dependency — a
 * registry name, a tarball, a git URL, and a `file:` local path all do.
 *
 * The second anchor exists for the other local-path shape: `dsh plugin add
 * /path/to/checkout` with no `file:` prefix records a pnpm `link:`, which
 * symlinks this directory in place and installs no dependencies at all. There
 * the profile directory that resolved this plugin holds `undici` instead.
 * Both anchors are attempts, never assumptions; the caller degrades to a direct
 * request when neither resolves.
 * @param ctx - Host context, queried for the launcher's `profileContext`.
 * @returns the `undici` module namespace.
 */
function loadUndici(ctx             )          {
  const anchors = [import.meta.url]
  const profile = service(ctx, 'profileContext')
  const profileDir = isRecord(profile) && typeof profile.dir === 'string' ? profile.dir : undefined
  if (profileDir !== undefined) anchors.push(pathToFileURL(join(profileDir, 'package.json')).href)
  let failure         
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('undici')
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

/** Notifiable event classes. */
                                                                

                       
                            
                                                                
                                        
 

                                           
                       
                                                 
                       
                        
                                                           
                         
 

                                           
                       
                      
                                                     
                          
 

                                               
                           
                           
                         
 

                                              
                          
                      
                                                     
 

/** ServerChan (Server酱) — WeChat push, reachable from mainland networks. */
                                                 
                             
                          
                                                         
                          
 

/** DingTalk (钉钉) group robot — text message, optional HMAC sign. */
                                               
                           
                      
                          
 

/** Feishu (飞书) group robot — text message, optional HMAC sign. */
                                             
                         
                      
                          
 

                                          
                      
 

              
               
               
                   
                  
                     
                   
                 
              

/** Plugin configuration (the Cordis row's `config`). */
                         
                                                                   
                                        
                                                                  
                                        
                                                      
                                     
     
                                                                            
                                                                            
                
     
                              
                                                                    
                            
     
                                                          
                                                                             
                                                                 
     
                         
                                                 
                             
     
                                                                             
                                                                              
                                  
     
                             
 

const DEFAULT_EVENTS                       = ['completed', 'error', 'question', 'approval']
const DEFAULT_TIMEOUT_MS = 5_000

                       
                     
                                                                      
 

                            
                       
                        
                     
 

                       
                                                                         
                                                            
                                                                         
                                
            
                                   
                                  
   
 

/** Identity of the Host process, attached to every notification. */
                          
                                                                  
                       
                                                   
                        
                                                                
                       
                                   
                        
                                                                    
                      
 

                   
                          
                        
                       
                            
                                  
                                 
 

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-host-notifier'

function isRecord(value         )                               {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeEvents(value         )                       {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_EVENTS
  const allowed = new Set           (DEFAULT_EVENTS)
  const picked = value.filter((item)                    => typeof item === 'string' && allowed.has(item             ))
  return picked.length === 0 ? DEFAULT_EVENTS : picked
}

function envChannels()          {
  const raw = process.env.DSH_NOTIFY_CHANNELS
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.warn('[host-notifier] DSH_NOTIFY_CHANNELS is not valid JSON; ignoring it', error)
    return undefined
  }
}

function normalizeChannels(raw         )            {
  if (!Array.isArray(raw)) return []
  const channels            = []
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
          ...isRecord(item.headers) ? { headers: item.headers                           } : {},
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
function questionSummary(data         )         {
  if (!isRecord(data)) return 'waiting for your answer'
  const args = typeof data.arguments === 'string'
    ? (() => { try { return JSON.parse(data.arguments) } catch { return undefined } })()
    : data.arguments
  if (!isRecord(args) || !Array.isArray(args.questions)) return 'waiting for your answer'
  const first = args.questions.find(isRecord)
  if (first === undefined || typeof first.question !== 'string') return 'waiting for your answer'
  return first.question.length > 200 ? `${first.question.slice(0, 197)}...` : first.question
}

function shortId(id        )         {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}

function sessionLabel(session             , title                    )         {
  if (title !== undefined && title !== '') return title
  const cwd = session.header.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    const parts = cwd.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? shortId(session.id)
  }
  return shortId(session.id)
}

/** Trimmed string when `value` is a non-empty string. */
function nonEmpty(value         )                     {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Friendly server name: config `serverName`, else the OS hostname. */
function resolveServerName(configured                    )         {
  const explicit = nonEmpty(configured)
  if (explicit !== undefined) return explicit
  try {
    const name = nonEmpty(hostname())
    if (name !== undefined) return name
  } catch {
    // A host without a resolvable hostname falls back to the environment.
  }
  return nonEmpty(process.env.HOSTNAME) ?? 'unknown-host'
}

/** OS user running the Host, when resolvable. */
function resolveServerUser()                     {
  try {
    const user = nonEmpty(userInfo().username)
    if (user !== undefined) return user
  } catch {
    // userInfo() throws when this process has no matching passwd entry.
  }
  return nonEmpty(process.env.USER) ?? nonEmpty(process.env.USERNAME)
}

/** Read one optional Host service without assuming the row exists. */
function service(ctx             , name        )          {
  try {
    return ctx.get?.(name)
  } catch {
    return undefined
  }
}

/** Read one string member from a service method, tolerating absence and throws. */
function serviceValue(target         , method        )                     {
  if (!isRecord(target)) return undefined
  try {
    // Even the property read can throw (accessor or proxy), so it stays guarded.
    const fn = target[method]
    if (typeof fn !== 'function') return undefined
    return nonEmpty((fn                 ).call(target))
  } catch {
    // Services throw before their listener binds; the tag just stays shorter.
    return undefined
  }
}

/** Drop the brackets the URL parser keeps around an IPv6 hostname. */
function unbracketed(host        )         {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Whether a URL hostname only ever reaches this machine. Such a URL is never
 * appended to a notification: every server prints `127.0.0.1` or `localhost`,
 * so it cannot tell deployments apart. The unspecified addresses `0.0.0.0` and
 * `::` are treated the same way: they name "some local interface", never a
 * particular host.
 */
function isLoopbackHost(hostname        )          {
  const host = unbracketed(hostname.toLowerCase()).replace(/\.+$/, '')
  if (host === 'localhost') return true
  if (host === '0.0.0.0' || host === '::') return true
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true
  if (/^(?:0{1,4}:){7}0{0,3}1$/.test(host) || host === '::1') return true
  // IPv4-mapped forms: `::ffff:127.0.0.1` (dotted) and `::ffff:7f00:1` (hex,
  // which is how the URL parser canonicalizes the dotted spelling).
  const mapped = /^(?:0{1,4}:){5}ffff:(.+)$/.exec(host) ?? /^::ffff:(.+)$/.exec(host)
  if (mapped === null) return false
  const tail = mapped[1]
  if (/^127(?:\.\d{1,3}){3}$/.test(tail)) return true
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
  return hex !== null && (Number.parseInt(hex[1], 16) >> 8) === 0x7f
}

/**
 * A candidate URL worth printing: absolute `http:`/`https:` on a host that is
 * not loopback. Anything malformed, non-HTTP, or loopback counts as absent.
 */
function publicUrl(candidate                    )                     {
  if (candidate === undefined) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return isLoopbackHost(url.hostname) ? undefined : candidate
  } catch {
    return undefined
  }
}

/**
 * Public Web GUI URL worth showing, if any. The webApp service answers with the
 * configured `publicUrl` and otherwise repeats the listener origin, and
 * `DSH_WEB_URL` carries that same loopback origin by default; both sources go
 * through {@link publicUrl}, so a loopback or malformed URL is simply absent.
 */
function resolveServerUrl(ctx             )                     {
  return publicUrl(serviceValue(service(ctx, 'webApp'), 'getAdvertisedUrl'))
    ?? publicUrl(nonEmpty(process.env.DSH_WEB_URL))
}

/** Listener port: `webServer.port` when bound, else the URL's explicit port. */
function resolveServerPort(ctx             )                     {
  const server = service(ctx, 'webServer')
  try {
    if (isRecord(server)) {
      const port          = server.port
      if (typeof port === 'number' && Number.isFinite(port) && port > 0) return port
    }
  } catch {
    // An unbound listener has no readable port yet.
  }
  const url = resolveServerUrl(ctx)
  if (url === undefined) return undefined
  try {
    const port = Number(new URL(url).port)
    return Number.isFinite(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

/** Identity of the Host process, derived from config and whatever services exist. */
function resolveServer(rawConfig        , ctx             )                 {
  const name = resolveServerName(rawConfig.serverName)
  const user = resolveServerUser()
  const url = resolveServerUrl(ctx)
  const port = resolveServerPort(ctx)
  return {
    name,
    ...user === undefined ? {} : { user },
    ...url === undefined ? {} : { url },
    ...port === undefined ? {} : { port },
    tag: port === undefined ? name : `${name}:${port}`,
  }
}

function displayKind(kind           )         {
  switch (kind) {
    case 'completed': return '会话完成'
    case 'error': return '会话出错'
    case 'question': return '需要你回答'
    case 'approval': return '需要你审批'
  }
}

                                                                      

async function deliver(
  channel         ,
  message         ,
  timeoutMs        ,
  doFetch           ,
)                {
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
      const payload          = await response.json().catch(() => undefined)
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
          server: {
            name: message.server.name,
            user: message.server.user,
            url: message.server.url,
            port: message.server.port,
          },
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
      const payload          = await response.json().catch(() => undefined)
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
      const payload          = await response.json().catch(() => undefined)
      if (isRecord(payload) && typeof payload.errcode === 'number' && payload.errcode !== 0) {
        throw new Error(`dingtalk errcode ${String(payload.errcode)}: ${String(payload.errmsg ?? '')}`)
      }
      return
    }
    case 'feishu': {
      const body                          = {
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
      const payload          = await response.json().catch(() => undefined)
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
export function apply(ctx             , rawConfig         = {})       {
  const events = normalizeEvents(rawConfig.events)
  const includeSubagents = rawConfig.includeSubagents === true
  const logOnly = rawConfig.logOnly === true
  const timeoutMs = typeof rawConfig.timeoutMs === 'number' && rawConfig.timeoutMs > 0
    ? rawConfig.timeoutMs
    : DEFAULT_TIMEOUT_MS
  const channels = normalizeChannels(rawConfig.channels ?? envChannels())
  const deliveryChannels            = logOnly ? [{ type: 'log' }] : channels
  if (deliveryChannels.length === 0) {
    ctx.logger?.warn('[host-notifier] no channels configured; notifications will be logged only')
    deliveryChannels.push({ type: 'log' })
  }
  const titles = new Map                ()
  const debugFile = typeof rawConfig.debugFile === 'string' && rawConfig.debugFile !== ''
    ? rawConfig.debugFile
    : undefined
  const record = (line        )       => {
    if (debugFile === undefined) return
    try {
      appendFileSync(debugFile, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // A trace file is diagnostic only; never let it affect delivery.
    }
  }
  const log = (message        )       => {
    if (ctx.logger?.info !== undefined) ctx.logger.info(message)
    else console.log(message)
  }
  const proxy = typeof rawConfig.proxy === 'string' && rawConfig.proxy !== '' ? rawConfig.proxy : undefined
  let doFetch            = (url, init) => globalThis.fetch(url, init)
  if (proxy !== undefined) {
    // Two independent failures, reported separately: the package cannot be
    // resolved, or it resolved and the configured proxy is unusable. Collapsing
    // them once blamed a typo'd `proxy` on a missing package, which for the
    // mainland-China Telegram case (where direct delivery cannot work) reads as
    // "notifications are fine" while they silently never arrive.
    let undici                          
    try {
      undici = loadUndici(ctx)                
    } catch (error) {
      ctx.logger?.warn(`[host-notifier] proxy requested but undici is unavailable; sending directly: ${String(error)}`)
      record(`proxy-unavailable ${String(error)}`)
    }
    if (undici !== undefined) {
      // Captured as a const so the closure below keeps the narrowed type.
      const loaded = undici
      try {
        const dispatcher = new loaded.ProxyAgent(proxy)
        doFetch = (url, init) => loaded.fetch(url, { ...init, dispatcher })
        log(`[host-notifier] proxy: ${proxy}`)
        record(`proxy ${proxy}`)
      } catch (error) {
        ctx.logger?.warn(`[host-notifier] invalid proxy ${JSON.stringify(proxy)}: undici loaded but ProxyAgent rejected it; sending directly: ${String(error)}`)
        record(`proxy-invalid ${JSON.stringify(proxy)} ${String(error)}`)
      }
    }
  }
  const server = resolveServer(rawConfig, ctx)
  const active = `[host-notifier] active: server=${server.tag} events=${events.join(',')} channels=${deliveryChannels.map(c => c.type).join(',')}`
  log(active)
  record(active)

  const notify = (kind           , session             , detail        )       => {
    if (!events.includes(kind)) return
    if (!includeSubagents && session.header.origin === 'subagent') return
    const cwd = typeof session.header.cwd === 'string' ? session.header.cwd : undefined
    const title = `[${server.tag}] DSH · ${sessionLabel(session, titles.get(session.id))}`
    const identity = `${server.user === undefined ? '' : `${server.user}@`}${server.tag}`
      + `${server.url === undefined ? '' : ` · ${server.url}`} · ${shortId(session.id)}`
    const text = `${displayKind(kind)}${detail === '' ? '' : ` · ${detail}`}`
      + `${cwd === undefined ? '' : `\n${cwd}`}\n${identity}`
    const message          = { kind, title, text, sessionId: session.id, cwd, server }
    record(`${kind} ${server.tag} ${session.id} ${text.replace(/\n/g, ' | ')}`)
    const targets = deliveryChannels.filter(channel => channel.events === undefined || channel.events.includes(kind))
    for (const channel of targets) {
      void deliver(channel, message, timeoutMs, doFetch).catch((error         ) => {
        record(`delivery-failed ${channel.type}: ${String(error)}`)
        ctx.logger?.warn(`[host-notifier] ${channel.type} delivery failed: ${String(error)}`)
      })
    }
  }

  ctx.effect(() => {
    const off = ctx.on('session/event', (session             , event                  ) => {
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
