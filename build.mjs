#!/usr/bin/env node
/**
 * Build `dist/index.js` from `index.ts`.
 *
 * The plugin ships COMPILED JavaScript on purpose: Node refuses to strip
 * TypeScript types for files inside `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so an installed package must
 * not point its entry at a `.ts` file. A git or tarball install runs no build
 * step either, so `dist/` is committed.
 *
 * The transform is Node's own `module.stripTypeScriptTypes` (Node >= 22.13),
 * which erases types without rewriting the rest of the file: no bundler, no
 * dev dependency, and the emitted module keeps the exact runtime behavior of
 * the source. `index.ts` is the only source of truth; never edit `dist/`.
 *
 * @module dsh-host-notifier/build
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'index.ts')
const targetPath = join(root, 'dist', 'index.js')

/** Statements that only exist in TypeScript; any survivor means the transform is unsound. */
const TYPE_SYNTAX = /(?:^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:interface|enum|namespace|type)\s+[A-Za-z_$]/

const banner = '// Generated from index.ts by build.mjs — do not edit. Run `node build.mjs` to refresh.\n'

const source = readFileSync(sourcePath, 'utf8')
const compiled = stripTypeScriptTypes(source, { mode: 'strip' })
if (TYPE_SYNTAX.test(compiled)) {
  throw new Error('build: TypeScript-only syntax survived stripping; dist/index.js would not be plain JavaScript')
}

mkdirSync(dirname(targetPath), { recursive: true })
writeFileSync(targetPath, banner + compiled)

// Import the artifact itself: a build that cannot load is not a build.
const built = await import(pathToFileURL(targetPath).href + `?built=${String(Date.now())}`)
if (typeof built.apply !== 'function' || built.name !== 'dsh-host-notifier') {
  throw new Error('build: dist/index.js does not export the plugin contract (name, apply)')
}

process.stdout.write(`built ${targetPath} (${String(compiled.length)} bytes) from ${sourcePath}\n`)
