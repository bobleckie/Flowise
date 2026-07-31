#!/usr/bin/env node
/**
 * Generate a district tile — one city block with its streets (SPEC.md M11).
 *
 *   node tools/build-district.mjs near_north_residential --preview
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import './lib/materials.mjs'
import './lib/streets.mjs'
import { loadCatalog } from './lib/catalog.mjs'
import { generateBuilding } from './lib/generate.mjs'
import { generateDistrict, tileSize } from './lib/district.mjs'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { renderIso } from './lib/render.mjs'
import { parseArgs } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TILES = JSON.parse(readFileSync(join(ROOT, 'data', 'districts', 'chicago.json'), 'utf8')).tiles

const args = parseArgs(process.argv.slice(2), {
    flags: ['preview', 'no-structure', 'list', 'shell'],
    options: ['out'],
    aliases: { o: 'out' }
})

if (args.list || !args._.length) {
    console.log('district tiles:')
    for (const [id, tile] of Object.entries(TILES)) {
        console.log(`  ${id.padEnd(26)} ${tileSize(tile).join('x').padStart(9)}  ${tile.name}`)
    }
    process.exit(args.list ? 0 : 1)
}

const catalog = new Map(loadCatalog().map((entry) => [entry.id, entry]))
const cache = new Map()
const buildFor = (id) => {
    if (!cache.has(id)) {
        const entry = catalog.get(id)
        cache.set(id, entry ? generateBuilding(entry, { shellOnly: Boolean(args.shell) }) : null)
    }
    return cache.get(id)
}

const out = args.out ?? join(ROOT, 'dist', 'districts')
mkdirSync(out, { recursive: true })

for (const name of args._) {
    const plan = TILES[name]
    if (!plan) {
        console.error(`unknown tile "${name}"`)
        process.exit(1)
    }
    const module = generateDistrict(plan, buildFor)
    writeFileSync(join(out, `${module.id}.module.json`), `${JSON.stringify(module, null, 2)}\n`)
    if (!args['no-structure']) writeMcStructure(join(out, `${module.id}.mcstructure`), moduleToModel(module))
    if (args.preview) {
        writeFileSync(
            join(out, `${module.id}.png`),
            renderIso(module.blocks, { maxPixels: 1400, background: [16, 18, 22] }).toPng()
        )
    }
    console.log(
        `${module.id}: ${module.footprint.join('x')}, ${module.blocks.length.toLocaleString()} blocks, ` +
        `${module.contents.length} buildings`
    )
}
