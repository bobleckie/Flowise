/**
 * Build-time material loading.
 *
 * `generate.mjs` deliberately has no Node imports so the same file runs inside
 * Bedrock's script engine. This is the Node-side shim that feeds it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setMaterials } from './generate.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export const MATERIALS = JSON.parse(readFileSync(join(ROOT, 'data', 'palettes', 'materials.json'), 'utf8')).systems

setMaterials(MATERIALS)
