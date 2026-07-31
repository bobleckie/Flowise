#!/usr/bin/env node
/**
 * Generate `fixtures/test_room.module.json` — the reference module for M1 and,
 * later, the M2 rotation harness.
 *
 * Scripted rather than hand-written, per SPEC.md §4.3. It is deliberately
 * loaded with the things that break structure pipelines: a directional block of
 * every common family, block entities that carry payloads (chest contents, sign
 * text), a waterlogged block, explicit air, and structure void.
 *
 *   node tools/gen-test-room.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringifyModule } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'fixtures', 'test_room.module.json')

const SIZE = [7, 4, 7] // a §4.2 interior footprint: 7x7, floor height 4

/**
 * Keyed by position so a later `put` replaces an earlier one — the shell is
 * laid down first and openings are then cut into it. A module may only name
 * each position once, so appending blindly would emit an invalid module.
 */
const cells = new Map()
const blockEntities = []

const put = (pos, block, state, extra) => {
    const entry = { pos, block }
    if (state && Object.keys(state).length) entry.state = state
    if (extra) Object.assign(entry, extra)
    cells.set(pos.join(','), entry)
    return entry
}

// --- nbt-json helpers ------------------------------------------------------

const byte = (value) => ({ type: 'byte', value })
const short = (value) => ({ type: 'short', value })
const int = (value) => ({ type: 'int', value })
const str = (value) => ({ type: 'string', value })
const compound = (value) => ({ type: 'compound', value })
const list = (elementType, value) => ({ type: 'list', elementType, value })

const blockEntityBase = ([x, y, z], id) => ({
    id: str(id),
    isMovable: byte(1),
    x: int(x),
    y: int(y),
    z: int(z)
})

// --- shell -----------------------------------------------------------------

const [sx, sy, sz] = SIZE
const isEdge = (x, z) => x === 0 || z === 0 || x === sx - 1 || z === sz - 1

for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
        put([x, 0, z], '$STYLE_FLOOR')
        put([x, sy - 1, z], '$STYLE_CEILING')

        for (let y = 1; y < sy - 1; y++) {
            if (isEdge(x, z)) put([x, y, z], '$STYLE_WALL')
            // Interior air is left as structure void so the module drops into
            // an existing shell without clearing what is already there.
        }
    }
}

// --- doorway (south wall, x=3) --------------------------------------------
// Both halves, so the door's upper/lower pairing is exercised by rotation.

put([3, 1, 0], 'minecraft:oak_door', { direction: 0, door_hinge_bit: false, open_bit: false, upper_block_bit: false })
put([3, 2, 0], 'minecraft:oak_door', { direction: 0, door_hinge_bit: false, open_bit: false, upper_block_bit: true })

// --- window (north wall) ---------------------------------------------------

for (const x of [2, 3, 4]) put([x, 2, sz - 1], 'minecraft:glass_pane')

// --- directional furniture -------------------------------------------------

// Stairs in each cardinal direction: the single most rotation-sensitive family.
put([1, 1, 1], 'minecraft:oak_stairs', { weirdo_direction: 0, upside_down_bit: false })
put([5, 1, 1], 'minecraft:oak_stairs', { weirdo_direction: 1, upside_down_bit: false })
put([1, 1, 5], 'minecraft:oak_stairs', { weirdo_direction: 2, upside_down_bit: false })
put([5, 1, 5], 'minecraft:oak_stairs', { weirdo_direction: 3, upside_down_bit: true })

// Ladder and trapdoor against the west wall.
put([1, 2, 3], 'minecraft:ladder', { facing_direction: 4 })
put([2, 2, 1], 'minecraft:oak_trapdoor', { direction: 2, open_bit: true, upside_down_bit: false })

// A waterlogged slab — layer 1 of the structure, the thing naive emitters drop.
put([4, 1, 3], 'minecraft:oak_slab', { 'minecraft:vertical_half': 'bottom' }, { waterlogged: true })

// Explicit air: clears whatever was there, unlike the omitted interior cells.
put([3, 1, 3], 'minecraft:air')

// --- block entities --------------------------------------------------------

const chestPos = [2, 1, 5]
put(chestPos, 'minecraft:chest', { 'minecraft:cardinal_direction': 'south' })
blockEntities.push({
    pos: chestPos,
    data: compound({
        ...blockEntityBase(chestPos, 'Chest'),
        Findable: byte(0),
        Items: list('compound', [
            compound({ Count: byte(12), Damage: short(0), Name: str('minecraft:oak_planks'), Slot: byte(0), WasPickedUp: byte(0) }),
            compound({ Count: byte(1), Damage: short(0), Name: str('minecraft:diamond_pickaxe'), Slot: byte(4), WasPickedUp: byte(0) })
        ])
    })
})

const signPos = [4, 2, 1]
put(signPos, 'minecraft:standing_sign', { ground_sign_direction: 8 })
blockEntities.push({
    pos: signPos,
    data: compound({
        ...blockEntityBase(signPos, 'Sign'),
        IsWaxed: byte(0),
        FrontText: compound({
            HideGlowOutline: byte(0),
            IgnoreLighting: byte(0),
            PersistFormatting: byte(1),
            SignTextColor: int(-16777216),
            Text: str('CITY BUILDER\nM1 test room'),
            TextOwner: str('')
        }),
        BackText: compound({
            HideGlowOutline: byte(0),
            IgnoreLighting: byte(0),
            PersistFormatting: byte(1),
            SignTextColor: int(-16777216),
            Text: str(''),
            TextOwner: str('')
        })
    })
})

// --- module ----------------------------------------------------------------

// Sorted by (x, y, z) so the file is stable across regenerations.
const blocks = [...cells.values()].sort(
    (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
)

const module = {
    id: 'test_room_7x7',
    footprint: SIZE,
    category: 'interior',
    connections: {
        north: ['exterior_wall'],
        south: ['door'],
        east: ['corridor'],
        west: ['corridor']
    },
    palette: {
        wall: '$STYLE_WALL',
        floor: '$STYLE_FLOOR',
        ceiling: '$STYLE_CEILING'
    },
    blocks,
    block_entities: blockEntities,
    entities: []
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, stringifyModule(module))
console.log(`wrote fixtures/test_room.module.json — ${blocks.length} blocks, ${blockEntities.length} block entities`)
