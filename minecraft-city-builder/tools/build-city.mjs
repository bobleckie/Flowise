#!/usr/bin/env node
/**
 * Assemble a city from district tiles (SPEC.md M14).
 *
 *   node tools/build-city.mjs --list
 *   node tools/build-city.mjs near_north --preview --shell
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import './lib/materials.mjs'
import './lib/streets.mjs'
import './lib/transit-data.mjs'
import { loadCatalog } from './lib/catalog.mjs'
import { generateBuilding } from './lib/generate.mjs'
import { generateCity, cityLayout } from './lib/city.mjs'
import { renderIso } from './lib/render.mjs'
import { parseArgs } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CITIES = JSON.parse(readFileSync(join(ROOT, 'data', 'cities', 'chicago.json'), 'utf8')).cities

const args = parseArgs(process.argv.slice(2), {
    flags: ['preview', 'list', 'shell', 'json'],
    options: ['out'],
    aliases: { o: 'out' }
})

if (args.list || !args._.length) {
    console.log('cities:')
    for (const [id, plan] of Object.entries(CITIES)) {
        const layout = cityLayout(plan)
        console.log(
            `  ${id.padEnd(14)} ${`${layout.width}x${layout.depth}`.padStart(9)}  ` +
            `${plan.rows.length}x${plan.columns.length} blocks  ${plan.name}`
        )
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

const out = args.out ?? join(ROOT, 'dist', 'cities')
mkdirSync(out, { recursive: true })

for (const name of args._) {
    const plan = CITIES[name]
    if (!plan) {
        console.error(`unknown city "${name}"`)
        process.exit(1)
    }

    const started = Date.now()
    const city = generateCity(plan, buildFor, (tile) => {
        process.stdout.write(`  ${tile.id}: ${tile.blocks.toLocaleString()} blocks\n`)
    })

    if (args.json) writeFileSync(join(out, `${city.id}.module.json`), `${JSON.stringify(city)}\n`)
    if (args.preview) {
        writeFileSync(
            join(out, `${city.id}.png`),
            renderIso(city.blocks, { maxPixels: 1600, background: [16, 18, 22] }).toPng()
        )
    }

    console.log(
        `${city.id}: ${city.footprint.join('x')}, ${city.blocks.length.toLocaleString()} blocks, ` +
        `${city.contents.length} buildings, ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
}
