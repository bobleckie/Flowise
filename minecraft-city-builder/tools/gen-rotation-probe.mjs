#!/usr/bin/env node
/**
 * Generate the M2 rotation probe: the automated harness the spec asks for.
 *
 * Several Bedrock state encodings in `data/block-states/rotation.json` are
 * marked below 'high' confidence — believed correct, not verified. Guessing
 * them would corrupt the entire preset library at once, so this measures them
 * instead.
 *
 * Produces:
 *   fixtures/rotation_probe.module.json         the base probe
 *   dist/probe/rotation_probe_<label>.mcstructure   one per orientation
 *   packs/city_builder_bp/scripts/probe_data.js     expectations for the runtime check
 *
 * The owner places each structure in-game and runs the check from the Build
 * Wand menu. The script reads the block states the game actually produced and
 * reports every disagreement with the table.
 *
 *   node tools/gen-rotation-probe.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rotateModule, ORIENTATIONS, TABLE } from './lib/rotation.mjs'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { validateModule } from './lib/module-format.mjs'
import { stringifyModule } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * One entry per state encoding worth measuring. `block` must be a block that
 * genuinely accepts every listed value, or the game will substitute something
 * else and the reading is meaningless.
 */
const PROBES = [
    { property: 'weirdo_direction', block: 'minecraft:oak_stairs', values: [0, 1, 2, 3], fixed: { upside_down_bit: false } },
    { property: 'weirdo_direction', block: 'minecraft:oak_stairs', values: [0, 2], fixed: { upside_down_bit: true }, tag: 'upsidedown' },
    { property: 'direction', block: 'minecraft:oak_trapdoor', values: [0, 1, 2, 3], fixed: { open_bit: false, upside_down_bit: false } },
    { property: 'direction', block: 'minecraft:oak_trapdoor', values: [0, 1, 2, 3], fixed: { open_bit: true, upside_down_bit: false }, tag: 'open' },
    { property: 'facing_direction', block: 'minecraft:dropper', values: [0, 1, 2, 3, 4, 5], fixed: { triggered_bit: false } },
    { property: 'ground_sign_direction', block: 'minecraft:standing_sign', values: [0, 2, 4, 6, 8, 10, 12, 14] },
    { property: 'minecraft:cardinal_direction', block: 'minecraft:furnace', values: ['north', 'south', 'east', 'west'] },
    { property: 'pillar_axis', block: 'minecraft:oak_log', values: ['x', 'y', 'z'] },
    { property: 'rail_direction', block: 'minecraft:rail', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { property: 'minecraft:block_face', block: 'minecraft:stone_button', values: ['up', 'north', 'south', 'east', 'west'] }
]

const PITCH = 3 // cell pitch, so neighbours never connect or support each other
const FLOOR = 'minecraft:stone'
const BACKING = 'minecraft:stone_bricks'

// --- lay out the probe -----------------------------------------------------

const cells = []
for (const probe of PROBES) {
    for (const value of probe.values) {
        cells.push({
            block: probe.block,
            state: { ...(probe.fixed ?? {}), [probe.property]: value },
            // Human-readable identity, echoed in the in-game report.
            label: `${probe.property}=${value}${probe.tag ? ` (${probe.tag})` : ''}`
        })
    }
}

// A wide-ish grid keeps the structure compact and easy to walk along.
const columns = 8
const rows = Math.ceil(cells.length / columns)
const SIZE = [columns * PITCH, 4, rows * PITCH]

const blocks = new Map()
const put = (pos, block, state) => {
    const entry = { pos, block }
    if (state && Object.keys(state).length) entry.state = state
    blocks.set(pos.join(','), entry)
}

const probeCells = []

cells.forEach((cell, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const ox = col * PITCH
    const oz = row * PITCH

    // Floor pad, plus a backing wall to the north so wall-mounted blocks have
    // something to attach to.
    for (let dx = 0; dx < PITCH; dx++) {
        for (let dz = 0; dz < PITCH; dz++) put([ox + dx, 0, oz + dz], FLOOR)
    }
    for (let dx = 0; dx < PITCH; dx++) put([ox + dx, 1, oz], BACKING)

    const pos = [ox + 1, 1, oz + 1]
    put(pos, cell.block, cell.state)
    probeCells.push({ pos, block: cell.block, state: cell.state, label: cell.label })
})

const probeModule = {
    id: 'rotation_probe',
    footprint: SIZE,
    category: 'fixture',
    connections: {},
    palette: {},
    blocks: [...blocks.values()].sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]),
    block_entities: [],
    entities: []
}

const errors = validateModule(probeModule)
if (errors.length) {
    console.error(`probe module is invalid:\n  - ${errors.join('\n  - ')}`)
    process.exit(1)
}

mkdirSync(join(ROOT, 'fixtures'), { recursive: true })
writeFileSync(join(ROOT, 'fixtures', 'rotation_probe.module.json'), stringifyModule(probeModule))

// --- emit every orientation, and what we expect to see ---------------------

const outDir = join(ROOT, 'dist', 'probe')
mkdirSync(outDir, { recursive: true })

const expectations = {}
let unhandledSeen = false

for (const orientation of ORIENTATIONS) {
    const { module, unhandled } = rotateModule(probeModule, orientation)
    if (unhandled.size) {
        unhandledSeen = true
        for (const [property, blockNames] of unhandled) {
            console.warn(`  WARNING  ${orientation.label}: "${property}" not rotated (${[...blockNames].join(', ')})`)
        }
    }

    writeFileSync(join(outDir, `rotation_probe_${orientation.label}.mcstructure`), writeMcStructure(moduleToModel(module)))

    // Map each original probe cell to where it should have landed. Rotating the
    // cell list the same way the module was rotated keeps the labels attached.
    const rotatedCells = rotateModule(
        { ...probeModule, blocks: probeCells.map(({ pos, block, state }) => ({ pos, block, state })) },
        orientation
    ).module.blocks

    expectations[orientation.label] = {
        footprint: module.footprint,
        cells: rotatedCells.map((cell, i) => ({
            pos: cell.pos,
            block: cell.block,
            state: cell.state ?? {},
            label: probeCells[i].label
        }))
    }
}

// --- runtime data for the in-game check ------------------------------------

const dataPath = join(ROOT, 'packs', 'city_builder_bp', 'scripts', 'probe_data.js')
writeFileSync(
    dataPath,
    `// GENERATED by tools/gen-rotation-probe.mjs — do not edit.\n` +
        `// Expected block states for each orientation of the M2 rotation probe.\n` +
        `export const PROBE_EXPECTATIONS = ${JSON.stringify(expectations, null, 2)}\n`
)

const pending = Object.entries(TABLE.properties).filter(([, spec]) => spec.confidence !== 'high')

console.log(`probe: ${probeCells.length} cells, footprint ${SIZE.join('x')}`)
console.log(`wrote fixtures/rotation_probe.module.json`)
console.log(`wrote ${ORIENTATIONS.length} structures to dist/probe/`)
console.log(`wrote packs/city_builder_bp/scripts/probe_data.js`)
console.log(`\n${pending.length} properties still need measuring in-game:`)
for (const [name, spec] of pending) console.log(`  ${spec.confidence.padEnd(6)} ${name}${spec.note ? ` — ${spec.note}` : ''}`)
if (unhandledSeen) process.exit(2)
