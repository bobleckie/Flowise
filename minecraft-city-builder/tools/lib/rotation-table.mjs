/**
 * Build-time loading of the rotation table.
 *
 * `rotation.mjs` deliberately has no Node imports so the same file runs inside
 * Bedrock's script engine. This is the Node-side shim that feeds it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setRotationTable } from './rotation.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export const ROTATION_TABLE = JSON.parse(readFileSync(join(ROOT, 'data', 'block-states', 'rotation.json'), 'utf8'))

setRotationTable(ROTATION_TABLE)
