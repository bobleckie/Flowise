/** Load the transit lines and inject them; build-time only. */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { setTransit } from './transit.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export const TRANSIT = JSON.parse(readFileSync(join(ROOT, 'data', 'transit', 'chicago.json'), 'utf8'))
setTransit(TRANSIT)
