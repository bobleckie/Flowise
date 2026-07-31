/**
 * Load the street cross-sections and inject them, mirroring
 * `tools/lib/materials.mjs`. Build-time only — the behaviour pack gets a
 * bundled copy instead, so `street.mjs` itself stays Node-import-free.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { setStreets } from './street.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const FILE = join(ROOT, 'data', 'streets', 'chicago.json')

export const STREETS = JSON.parse(readFileSync(FILE, 'utf8'))
setStreets(STREETS)
