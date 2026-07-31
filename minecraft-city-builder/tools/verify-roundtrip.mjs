#!/usr/bin/env node
/**
 * M1 acceptance tool. Takes a real `.mcstructure` captured in-game and reports
 * whether it survives the pipeline unchanged.
 *
 *   node tools/verify-roundtrip.mjs captures/my_room.mcstructure
 *
 * Two independent checks, because they can fail for different reasons:
 *
 *   1. NBT layer     bytes -> tree -> bytes must be byte-identical. A failure
 *                    here means the reader or writer is wrong, full stop.
 *   2. Module layer  bytes -> model -> module -> model -> bytes must preserve
 *                    every block, state, block entity and entity. Tag ordering
 *                    may legitimately differ from the game's own output, so
 *                    this compares meaning, and reports byte equality
 *                    separately as information rather than as a failure.
 */

import { readFileSync } from 'node:fs'
import { readNbt, writeNbt } from './lib/nbt.mjs'
import { parseMcStructure, writeMcStructure, positionOf } from './lib/mcstructure.mjs'
import { modelToModule, moduleToModel } from './lib/module-format.mjs'
import { blockKey } from './lib/nbt-json.mjs'
import { parseArgs, fail } from './lib/cli.mjs'

const USAGE = `usage: verify-roundtrip <file.mcstructure> [--verbose]`

let args
try {
    args = parseArgs(process.argv.slice(2), { flags: ['verbose'], options: [] })
} catch (error) {
    fail(error.message, USAGE)
}

const input = args._[0]
if (!input) fail('no .mcstructure file given', USAGE)

const original = readFileSync(input)
const problems = []
const notes = []

// --- check 1: raw NBT byte identity ---------------------------------------

let nbtIdentical = false
try {
    const { name, root } = readNbt(original)
    const rewritten = writeNbt(root, name)
    nbtIdentical = rewritten.equals(original)
    if (!nbtIdentical) {
        const at = firstDifference(original, rewritten)
        problems.push(
            `NBT layer is not byte-identical (${original.length} bytes in, ${rewritten.length} out, ` +
                `first difference at byte ${at})`
        )
    }
} catch (error) {
    problems.push(`NBT layer failed to parse: ${error.message}`)
}

// --- check 2: module layer semantic identity ------------------------------

let before
let after
try {
    before = parseMcStructure(original)
    const module = modelToModule(before, { id: 'roundtrip' })
    after = parseMcStructure(writeMcStructure(moduleToModel(module, { origin: before.origin })))
} catch (error) {
    problems.push(`module layer failed: ${error.message}`)
}

if (before && after) {
    problems.push(...compareModels(before, after))
    const reserialized = writeMcStructure(before)
    notes.push(
        reserialized.equals(original)
            ? 'model layer is also byte-identical to the original'
            : 'model layer differs from the original at the byte level (tag ordering) but not in meaning'
    )
}

// --- report ---------------------------------------------------------------

console.log(`${input}`)
if (before) {
    console.log(
        `  footprint ${before.size.join('x')}, ${before.palette.length} palette entries, ` +
            `${before.blockEntities.size} block entities, ${before.entities.length} entities`
    )
}
console.log(`  NBT byte identity: ${nbtIdentical ? 'PASS' : 'FAIL'}`)
console.log(`  module round-trip: ${problems.length === 0 ? 'PASS' : 'FAIL'}`)
for (const note of notes) console.log(`  note: ${note}`)

if (problems.length) {
    console.error('\nProblems:')
    for (const problem of problems.slice(0, args.verbose ? Infinity : 20)) console.error(`  - ${problem}`)
    if (!args.verbose && problems.length > 20) console.error(`  ... and ${problems.length - 20} more (--verbose for all)`)
    process.exit(1)
}
console.log('\nRound-trip clean.')

// --- helpers ---------------------------------------------------------------

function firstDifference(a, b) {
    const limit = Math.min(a.length, b.length)
    for (let i = 0; i < limit; i++) if (a[i] !== b[i]) return i
    return limit
}

function compareModels(a, b) {
    const found = []
    if (a.size.join(',') !== b.size.join(',')) {
        return [`size changed: ${a.size.join('x')} -> ${b.size.join('x')}`]
    }

    for (const [layerIndex, layer] of a.layers.entries()) {
        for (let i = 0; i < layer.length; i++) {
            const beforeIndex = layer[i]
            const afterIndex = b.layers[layerIndex][i]

            // -1 (structure void) must stay -1; anything else must resolve to
            // the same block, even though palette slots may be renumbered.
            if (beforeIndex < 0 || afterIndex < 0) {
                if (beforeIndex !== afterIndex) {
                    found.push(
                        `layer ${layerIndex} at ${positionOf(a.size, i).join(',')}: ` +
                            `${describe(a, beforeIndex)} -> ${describe(b, afterIndex)}`
                    )
                }
                continue
            }
            const beforeBlock = a.palette[beforeIndex]
            const afterBlock = b.palette[afterIndex]
            const beforeKey = blockKey(beforeBlock.name, beforeBlock.state)
            const afterKey = blockKey(afterBlock.name, afterBlock.state)
            if (beforeKey !== afterKey) {
                found.push(`layer ${layerIndex} at ${positionOf(a.size, i).join(',')}: ${beforeKey} -> ${afterKey}`)
            } else if (beforeBlock.version !== afterBlock.version) {
                found.push(
                    `layer ${layerIndex} at ${positionOf(a.size, i).join(',')}: ` +
                        `${beforeKey} version ${beforeBlock.version} -> ${afterBlock.version}`
                )
            }
        }
    }

    for (const [index, data] of a.blockEntities) {
        const other = b.blockEntities.get(index)
        if (!other) {
            found.push(`block entity at ${positionOf(a.size, index).join(',')} was lost`)
        } else if (!writeNbt(data, '').equals(writeNbt(other, ''))) {
            found.push(`block entity at ${positionOf(a.size, index).join(',')} changed`)
        }
    }
    for (const index of b.blockEntities.keys()) {
        if (!a.blockEntities.has(index)) found.push(`block entity at ${positionOf(a.size, index).join(',')} appeared`)
    }

    if (a.entities.length !== b.entities.length) {
        found.push(`entity count changed: ${a.entities.length} -> ${b.entities.length}`)
    } else {
        a.entities.forEach((entity, i) => {
            if (!writeNbt(entity, '').equals(writeNbt(b.entities[i], ''))) found.push(`entity ${i} changed`)
        })
    }

    return found
}

function describe(model, index) {
    if (index < 0) return 'structure void'
    const entry = model.palette[index]
    return entry ? blockKey(entry.name, entry.state) : `<missing palette entry ${index}>`
}
