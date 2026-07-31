#!/usr/bin/env node
/**
 * Convert a Bedrock `.mcstructure` — typically captured in-game with a
 * structure block — back into the module intermediate format, so hand-built
 * rooms can enter the pipeline.
 *
 *   node tools/mcstructure-to-module.mjs captures/lobby.mcstructure \
 *        --id lobby_hero --category interior -o modules/lobby_hero.module.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { parseMcStructure } from './lib/mcstructure.mjs'
import { modelToModule, validateModule } from './lib/module-format.mjs'
import { parseArgs, fail, stringifyModule } from './lib/cli.mjs'

const USAGE = `usage: mcstructure-to-module <file.mcstructure> [options]

  -o, --out <path>      output path (default: alongside input, .module.json)
      --id <id>         module id (default: the input filename)
      --category <c>    interior | facade | roof | core | fixture (default: interior)
      --summary         print a block histogram instead of writing a file`

let args
try {
    args = parseArgs(process.argv.slice(2), { flags: ['summary'], options: ['out', 'id', 'category'], aliases: { o: 'out' } })
} catch (error) {
    fail(error.message, USAGE)
}

const input = args._[0]
if (!input) fail('no .mcstructure file given', USAGE)

let model
try {
    model = parseMcStructure(readFileSync(input))
} catch (error) {
    fail(`${input}: ${error.message}`)
}

const id = args.id ?? basename(input).replace(/\.mcstructure$/, '')
const module = modelToModule(model, { id, category: args.category ?? 'interior' })

if (args.summary) {
    const counts = new Map()
    for (const block of module.blocks) counts.set(block.block, (counts.get(block.block) ?? 0) + 1)
    console.log(`${id}: footprint ${module.footprint.join('x')}, ${module.blocks.length} blocks`)
    for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(6)}  ${name}`)
    }
    console.log(`  block entities: ${module.block_entities.length}, entities: ${module.entities.length}`)
    process.exit(0)
}

const errors = validateModule(module)
if (errors.length) fail(`converted module is invalid (this is a converter bug):\n  - ${errors.join('\n  - ')}`)

const out = args.out ?? join(dirname(input), `${id}.module.json`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, stringifyModule(module))

console.log(
    `${id}: footprint ${module.footprint.join('x')}, ${module.blocks.length} blocks, ` +
        `${module.block_entities.length} block entities, ${module.entities.length} entities`
)
console.log(`wrote ${out}`)
console.log('\nNext: fill in "category", "connections", and swap concrete blocks for $STYLE_* tokens.')
