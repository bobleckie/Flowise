#!/usr/bin/env node
/**
 * Rotate and/or mirror a module.
 *
 *   node tools/rotate-module.mjs fixtures/test_room.module.json --turns 1
 *   node tools/rotate-module.mjs room.module.json --mirror x -o room_mx.module.json
 *   node tools/rotate-module.mjs room.module.json --all --out-dir out/orientations
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import './lib/rotation-table.mjs' // binds the rotation table
import { rotateModule, ORIENTATIONS } from './lib/rotation.mjs'
import { validateModule } from './lib/module-format.mjs'
import { parseArgs, fail, stringifyModule } from './lib/cli.mjs'

const USAGE = `usage: rotate-module <module.json> [options]

      --turns <0-3>      quarter turns clockwise viewed from above (default 0)
      --mirror <x|z>     mirror across the X or Z axis, applied before the turn
      --all              write all six orientations (4 rotations + both mirrors)
  -o, --out <path>       output path (single orientation only)
      --out-dir <dir>    output directory (default: alongside input)`

let args
try {
    args = parseArgs(process.argv.slice(2), {
        flags: ['all'],
        options: ['turns', 'mirror', 'out', 'out-dir'],
        aliases: { o: 'out' }
    })
} catch (error) {
    fail(error.message, USAGE)
}

const input = args._[0]
if (!input) fail('no module file given', USAGE)
if (args.all && args.out) fail('--all writes several files; use --out-dir instead of --out')

const module = JSON.parse(readFileSync(input, 'utf8'))
const errors = validateModule(module)
if (errors.length) fail(`module "${module.id}" is invalid:\n  - ${errors.join('\n  - ')}`)

const outDir = args['out-dir'] ?? dirname(input)
const stem = basename(input).replace(/\.(module\.)?json$/, '')

const orientations = args.all
    ? ORIENTATIONS
    : [
          {
              turns: args.turns === undefined ? 0 : Number.parseInt(args.turns, 10),
              mirror: args.mirror ?? null,
              label: null
          }
      ]

if (!args.all) {
    const { turns, mirror } = orientations[0]
    if (!Number.isInteger(turns) || turns < 0 || turns > 3) fail('--turns must be 0, 1, 2 or 3')
    if (mirror !== null && mirror !== 'x' && mirror !== 'z') fail("--mirror must be 'x' or 'z'")
}

let sawUnhandled = false

for (const orientation of orientations) {
    let result
    try {
        result = rotateModule(module, orientation)
    } catch (error) {
        fail(error.message, USAGE)
    }

    const label = orientation.label ?? `${orientation.mirror ? `m${orientation.mirror}` : ''}r${(orientation.turns ?? 0) * 90}`
    const out = args.out ?? join(outDir, `${stem}_${label}.module.json`)

    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, stringifyModule(result.module))

    const problems = validateModule(result.module)
    if (problems.length) {
        // A rotation that produces an invalid module is a rotation bug.
        fail(`${label}: rotated module is invalid (this is a rotation bug):\n  - ${problems.join('\n  - ')}`)
    }

    console.log(`${label}: footprint ${result.module.footprint.join('x')} -> ${out}`)

    for (const [property, blocks] of result.unhandled) {
        sawUnhandled = true
        console.warn(`  WARNING  "${property}" could not be rotated (on ${[...blocks].join(', ')})`)
    }
}

if (sawUnhandled) {
    console.warn(
        '\nUnhandled directional properties were left untouched, which means those blocks\n' +
            'will face the wrong way. Add them to data/block-states/rotation.json.'
    )
    process.exit(2)
}
