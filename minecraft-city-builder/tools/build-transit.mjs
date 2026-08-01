#!/usr/bin/env node
/**
 * Generate a transit run, with a preview (SPEC.md M10).
 *
 *   node tools/build-transit.mjs loop_elevated --over arterial --station --preview
 *   node tools/build-transit.mjs red_subway --over arterial --station --preview
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import './lib/streets.mjs'
import './lib/transit-data.mjs'
import { generateStreet } from './lib/street.mjs'
import { generateElevated, generateSubway, streetcarOverlay, transitLine, getTransit } from './lib/transit.mjs'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { renderIso } from './lib/render.mjs'
import { parseArgs } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const args = parseArgs(process.argv.slice(2), {
    flags: ['preview', 'no-structure', 'list', 'station', 'bare'],
    options: ['out', 'length', 'over'],
    aliases: { o: 'out', l: 'length' }
})

if (args.list || !args._.length) {
    console.log('transit lines:')
    for (const [id, line] of Object.entries(getTransit().lines)) {
        console.log(`  ${id.padEnd(18)} ${line.kind.padEnd(10)} ${line.name}`)
    }
    process.exit(args.list ? 0 : 1)
}

const out = args.out ?? join(ROOT, 'dist', 'transit')
mkdirSync(out, { recursive: true })

const name = args._[0]
const line = transitLine(name)
const over = args.over ?? 'arterial'
const length = Number(args.length ?? 48)
const station = Boolean(args.station)

let module
if (line.kind === 'subway') module = generateSubway(over, name, { length, station })
else if (line.kind === 'streetcar') module = streetcarOverlay(over, name, { length })
else module = generateElevated(over, name, { length, station })

// Previews are far more legible with the street the line runs over underneath
// it — an elevated railway on its own is a row of columns in the air.
if (args.preview && !args.bare) {
    const street = generateStreet(over, { length })
    const lift = line.kind === 'subway' ? module.grade : 0
    const merged = new Map()
    for (const block of module.blocks) merged.set(block.pos.join(','), block)
    for (const block of street.blocks) {
        const pos = [block.pos[0], block.pos[1] + lift, block.pos[2]]
        const key = pos.join(',')
        if (!merged.has(key)) merged.set(key, { ...block, pos })
    }
    module = { ...module, blocks: [...merged.values()] }
}

writeFileSync(join(out, `${module.id}.module.json`), `${JSON.stringify(module, null, 2)}\n`)
if (!args['no-structure']) writeMcStructure(join(out, `${module.id}.mcstructure`), moduleToModel(module))
if (args.preview) {
    writeFileSync(
        join(out, `${module.id}.png`),
        renderIso(module.blocks, { maxPixels: 1200, background: [16, 18, 22] }).toPng()
    )
}

console.log(`${module.id}: ${module.footprint.join('x')}, ${module.blocks.length.toLocaleString()} blocks -> ${out}`)
