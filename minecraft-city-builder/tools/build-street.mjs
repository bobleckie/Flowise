#!/usr/bin/env node
/**
 * Generate a street segment or an intersection, with a preview (SPEC.md M9).
 *
 *   node tools/build-street.mjs residential --length 40 --preview
 *   node tools/build-street.mjs arterial --cross commercial --preview
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import './lib/streets.mjs'
import { generateStreet, generateIntersection, getStreets } from './lib/street.mjs'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { renderIso } from './lib/render.mjs'
import { parseArgs } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const args = parseArgs(process.argv.slice(2), {
    flags: ['preview', 'no-structure', 'list', 'bus-stop'],
    options: ['out', 'length', 'cross'],
    aliases: { o: 'out', l: 'length' }
})
const positional = args._

if (args.list || !positional.length) {
    const types = getStreets().types
    console.log('street types:')
    for (const [id, type] of Object.entries(types)) {
        console.log(`  ${id.padEnd(14)} ${String(type.row).padStart(3)} blocks  ${type.name}`)
    }
    console.log('\nusage: node tools/build-street.mjs <type> [--cross <type>] [--length N] [--preview]')
    process.exit(positional.length ? 0 : 1)
}

const out = args.out ?? join(ROOT, 'dist', 'streets')
mkdirSync(out, { recursive: true })

const name = positional[0]
const module = args.cross
    ? generateIntersection(name, args.cross)
    : generateStreet(name, { length: Number(args.length ?? 32), busStop: Boolean(args['bus-stop']) })

writeFileSync(join(out, `${module.id}.module.json`), `${JSON.stringify(module, null, 2)}\n`)
if (!args['no-structure']) {
    writeMcStructure(join(out, `${module.id}.mcstructure`), moduleToModel(module))
}
if (args.preview) {
    writeFileSync(join(out, `${module.id}.png`), renderIso(module.blocks, { maxPixels: 1100, background: [16, 18, 22] }).toPng())
}

console.log(`${module.id}: ${module.footprint.join('x')}, ${module.blocks.length.toLocaleString()} blocks -> ${out}`)
