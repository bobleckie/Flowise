/**
 * M2 rotation tests.
 *
 * The strongest checks here do not depend on knowing Bedrock's true enum
 * mappings. Rotation and mirroring form a group, so `R^4 = I`, `M^2 = I` and
 * `R^2 = Mx . Mz` must hold no matter what the encodings are. An internally
 * inconsistent table fails these even when nobody knows the ground truth yet.
 *
 * Ground truth for anything the table marks below 'high' confidence still has
 * to be measured in-game — see `tools/gen-rotation-probe.mjs`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import '../lib/rotation-table.mjs' // binds the rotation table
import {
    TABLE,
    rotateState,
    rotateModule,
    rotatePosition,
    rotateFootprint,
    rotateConnections,
    lowConfidenceProperties,
    ORIENTATIONS
} from '../lib/rotation.mjs'
import { moduleToModel, validateModule } from '../lib/module-format.mjs'
import { writeMcStructure } from '../lib/mcstructure.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
const testRoom = () => readJson('fixtures/test_room.module.json')
const brownstone = () => readJson('data/styles/brownstone.json')

const rot = (module, turns, mirror = null) => rotateModule(module, { turns, mirror }).module
const byPos = (module) => new Map(module.blocks.map((b) => [b.pos.join(','), b]))

// --- compass basics --------------------------------------------------------

test('one turn maps north -> east across every encoding', () => {
    // facing_direction: 2 = north, 5 = east
    assert.deepEqual(rotateState({ facing_direction: 2 }, 1).state, { facing_direction: 5 })
    // weirdo_direction (stairs): 3 = north, 0 = east
    assert.deepEqual(rotateState({ weirdo_direction: 3 }, 1).state, { weirdo_direction: 0 })
    // direction (doors): 3 = north, 0 = east
    assert.deepEqual(rotateState({ direction: 3 }, 1).state, { direction: 0 })
    // string encodings say it plainly
    assert.deepEqual(rotateState({ 'minecraft:cardinal_direction': 'north' }, 1).state, {
        'minecraft:cardinal_direction': 'east'
    })
})

test('the full compass cycle is north -> east -> south -> west', () => {
    const cycle = ['north', 'east', 'south', 'west']
    for (let i = 0; i < 4; i++) {
        assert.equal(
            rotateState({ 'minecraft:cardinal_direction': cycle[i] }, 1).state['minecraft:cardinal_direction'],
            cycle[(i + 1) % 4]
        )
    }
})

test('up and down survive rotation untouched', () => {
    for (const value of [0, 1]) {
        for (let turns = 0; turns < 4; turns++) {
            assert.equal(rotateState({ facing_direction: value }, turns).state.facing_direction, value)
        }
    }
})

test('pillar_axis swaps x and z on an odd number of turns only', () => {
    assert.equal(rotateState({ pillar_axis: 'x' }, 1).state.pillar_axis, 'z')
    assert.equal(rotateState({ pillar_axis: 'x' }, 2).state.pillar_axis, 'x')
    assert.equal(rotateState({ pillar_axis: 'z' }, 3).state.pillar_axis, 'x')
    assert.equal(rotateState({ pillar_axis: 'y' }, 1).state.pillar_axis, 'y')
    // A mirror about X or Z does not change which axis a pillar runs along.
    assert.equal(rotateState({ pillar_axis: 'x' }, 0, 'x').state.pillar_axis, 'x')
})

test('a door hinge is unmoved by rotation and flipped by either mirror', () => {
    assert.equal(rotateState({ door_hinge_bit: true }, 2).state.door_hinge_bit, true)
    assert.equal(rotateState({ door_hinge_bit: true }, 0, 'x').state.door_hinge_bit, false)
    assert.equal(rotateState({ door_hinge_bit: false }, 0, 'z').state.door_hinge_bit, true)
})

test('face-suffixed property names rotate, keeping their values', () => {
    const state = { wall_connection_type_north: 'short', wall_connection_type_east: 'tall' }
    assert.deepEqual(rotateState(state, 1).state, {
        wall_connection_type_east: 'short',
        wall_connection_type_south: 'tall'
    })
})

// --- group properties ------------------------------------------------------

test('four turns is the identity, for positions and every state encoding', () => {
    const original = testRoom()
    let module = original
    for (let i = 0; i < 4; i++) module = rot(module, 1)

    assert.deepEqual(module.footprint, original.footprint)
    const before = byPos(original)
    const after = byPos(module)
    assert.equal(after.size, before.size)

    for (const [key, block] of before) {
        const round = after.get(key)
        assert.ok(round, `position ${key} vanished after four turns`)
        assert.equal(round.block, block.block, `block at ${key}`)
        assert.deepEqual(round.state ?? {}, block.state ?? {}, `state at ${key}`)
    }
})

test('each mirror is its own inverse', () => {
    const original = testRoom()
    for (const axis of ['x', 'z']) {
        const round = rot(rot(original, 0, axis), 0, axis)
        assert.deepEqual(round.footprint, original.footprint)
        const before = byPos(original)
        for (const [key, block] of byPos(round)) {
            assert.deepEqual(block.state ?? {}, before.get(key).state ?? {}, `${axis}-mirror twice at ${key}`)
            assert.equal(block.block, before.get(key).block)
        }
    }
})

test('a half turn equals mirroring on both axes', () => {
    const original = testRoom()
    const halfTurn = rot(original, 2)
    const bothMirrors = rot(rot(original, 0, 'x'), 0, 'z')

    const expected = byPos(halfTurn)
    assert.equal(bothMirrors.blocks.length, halfTurn.blocks.length)
    for (const block of bothMirrors.blocks) {
        const want = expected.get(block.pos.join(','))
        assert.ok(want, `R180 has no block at ${block.pos}`)
        assert.equal(block.block, want.block, `block at ${block.pos}`)
        assert.deepEqual(block.state ?? {}, want.state ?? {}, `state at ${block.pos}`)
    }
})

test('rotation composes: R1 then R2 equals R3', () => {
    const original = testRoom()
    const composed = rot(rot(original, 1), 2)
    const direct = rot(original, 3)

    const expected = byPos(direct)
    for (const block of composed.blocks) {
        const want = expected.get(block.pos.join(','))
        assert.ok(want, `no block at ${block.pos}`)
        assert.deepEqual(block.state ?? {}, want.state ?? {}, `state at ${block.pos}`)
    }
})

// --- structural integrity --------------------------------------------------

test('every orientation stays in bounds with no collisions', () => {
    const original = testRoom()
    for (const orientation of ORIENTATIONS) {
        const module = rot(original, orientation.turns, orientation.mirror)
        const [sx, sy, sz] = module.footprint

        const seen = new Set()
        for (const block of module.blocks) {
            const [x, y, z] = block.pos
            assert.ok(x >= 0 && x < sx, `${orientation.label}: x=${x} outside 0..${sx - 1}`)
            assert.ok(y >= 0 && y < sy, `${orientation.label}: y=${y} outside 0..${sy - 1}`)
            assert.ok(z >= 0 && z < sz, `${orientation.label}: z=${z} outside 0..${sz - 1}`)

            const key = block.pos.join(',')
            assert.ok(!seen.has(key), `${orientation.label}: two blocks landed on ${key}`)
            seen.add(key)
        }
        assert.equal(module.blocks.length, original.blocks.length, `${orientation.label}: block count changed`)
    }
})

test('an odd number of turns swaps the footprint axes', () => {
    assert.deepEqual(rotateFootprint([7, 4, 11], 0), [7, 4, 11])
    assert.deepEqual(rotateFootprint([7, 4, 11], 1), [11, 4, 7])
    assert.deepEqual(rotateFootprint([7, 4, 11], 2), [7, 4, 11])
    assert.deepEqual(rotateFootprint([7, 4, 11], 3), [11, 4, 7])
})

test('positions rotate correctly in a non-square footprint', () => {
    const footprint = [3, 1, 5] // x = 3, z = 5
    // One turn: (x, z) -> (sz - 1 - z, x), so the box becomes 5 x 3.
    assert.deepEqual(rotatePosition([0, 0, 0], footprint, 1), [4, 0, 0])
    assert.deepEqual(rotatePosition([0, 0, 4], footprint, 1), [0, 0, 0])
    assert.deepEqual(rotatePosition([2, 0, 4], footprint, 1), [0, 0, 2])
    // Corners must map to corners.
    const corners = [[0, 0, 0], [2, 0, 0], [0, 0, 4], [2, 0, 4]]
    const rotated = corners.map((c) => rotatePosition(c, footprint, 1).join(','))
    assert.deepEqual([...new Set(rotated)].sort(), ['0,0,0', '0,0,2', '4,0,0', '4,0,2'])
})

test('block entities move with their blocks', () => {
    const original = testRoom()
    for (const orientation of ORIENTATIONS) {
        const module = rot(original, orientation.turns, orientation.mirror)
        const occupied = new Set(module.blocks.map((b) => b.pos.join(',')))

        assert.equal(module.block_entities.length, original.block_entities.length)
        for (const entry of module.block_entities) {
            assert.ok(occupied.has(entry.pos.join(',')), `${orientation.label}: block entity at ${entry.pos} has no block`)
        }
    }
})

test('declared edge connections travel with the module', () => {
    assert.deepEqual(rotateConnections({ north: ['a'], east: ['b'] }, 1, null), { east: ['a'], south: ['b'] })
    assert.deepEqual(rotateConnections({ east: ['a'], west: ['b'] }, 0, 'x'), { west: ['a'], east: ['b'] })
    const room = rot(testRoom(), 1)
    assert.deepEqual(room.connections, { east: ['exterior_wall'], west: ['door'], south: ['corridor'], north: ['corridor'] })
})

// --- domain safety ---------------------------------------------------------

/** Legal values a property may hold, derived from the table itself. */
function domainOf(name) {
    const spec = TABLE.properties[name]
    if (!spec) return null
    if (spec.semantic === 'angle16') return new Set(Array.from({ length: 16 }, (_, i) => i))
    if (spec.identity) return null // string faces, checked separately
    if (spec.values) return new Set(Object.keys(spec.values).map(Number))
    return null
}

test('no orientation can push a state value outside its legal domain', () => {
    const numeric = Object.keys(TABLE.properties).filter((name) => domainOf(name))

    for (const name of numeric) {
        const domain = domainOf(name)
        for (const value of domain) {
            for (const orientation of ORIENTATIONS) {
                const result = rotateState({ [name]: value }, orientation.turns, orientation.mirror)
                const next = result.state[name]
                assert.ok(
                    domain.has(next),
                    `${name}=${value} under ${orientation.label} produced ${next}, outside its domain`
                )
                assert.deepEqual(result.unhandled, [], `${name}=${value} was reported unhandled`)
            }
        }
    }
})

test('every numeric encoding is a permutation, never collapsing two values into one', () => {
    // A table typo that maps two directions onto the same value would quietly
    // rotate two different blocks into the same facing.
    for (const name of Object.keys(TABLE.properties)) {
        const domain = domainOf(name)
        if (!domain) continue
        for (const orientation of ORIENTATIONS) {
            const images = [...domain].map((value) => rotateState({ [name]: value }, orientation.turns, orientation.mirror).state[name])
            assert.equal(new Set(images).size, domain.size, `${name} under ${orientation.label} is not a permutation`)
        }
    }
})

test('string face encodings stay within the compass', () => {
    const legal = new Set(['north', 'south', 'east', 'west', 'up', 'down'])
    for (const face of legal) {
        for (const orientation of ORIENTATIONS) {
            const next = rotateState({ 'minecraft:cardinal_direction': face }, orientation.turns, orientation.mirror).state
            assert.ok(legal.has(next['minecraft:cardinal_direction']), `${face} -> ${next['minecraft:cardinal_direction']}`)
        }
    }
})

test('rails stay legal rails through every orientation', () => {
    const domain = new Set(Object.keys(TABLE.properties.rail_direction.values).map(Number))
    for (const value of domain) {
        for (const orientation of ORIENTATIONS) {
            const result = rotateState({ rail_direction: value }, orientation.turns, orientation.mirror)
            assert.ok(domain.has(result.state.rail_direction), `rail ${value} under ${orientation.label}`)
            assert.deepEqual(result.unhandled, [])
        }
    }
    // Straight rails must alternate axis with each quarter turn.
    assert.equal(rotateState({ rail_direction: 0 }, 1).state.rail_direction, 1)
    assert.equal(rotateState({ rail_direction: 1 }, 1).state.rail_direction, 0)
})

test('a 16-step sign angle rotates by exactly four steps', () => {
    for (let value = 0; value < 16; value++) {
        assert.equal(rotateState({ ground_sign_direction: value }, 1).state.ground_sign_direction, (value + 4) % 16)
    }
    // And a mirror is a reflection: applying it twice returns the original.
    for (let value = 0; value < 16; value++) {
        for (const axis of ['x', 'z']) {
            const once = rotateState({ ground_sign_direction: value }, 0, axis).state.ground_sign_direction
            const twice = rotateState({ ground_sign_direction: once }, 0, axis).state.ground_sign_direction
            assert.equal(twice, value, `${axis}-mirror twice on ${value}`)
        }
    }
})

// --- unhandled reporting ---------------------------------------------------

test('an unknown directional property is reported, not silently passed through', () => {
    const result = rotateState({ some_new_facing_thing: 3 }, 1)
    assert.deepEqual(result.unhandled, ['some_new_facing_thing'])
    assert.equal(result.state.some_new_facing_thing, 3, 'value is left alone rather than guessed at')
})

test('properties that genuinely do not rotate are not reported', () => {
    const state = { upside_down_bit: true, open_bit: false, 'minecraft:vertical_half': 'top', liquid_depth: 0 }
    const result = rotateState(state, 1)
    assert.deepEqual(result.unhandled, [])
    assert.deepEqual(result.state, state)
})

test('non-directional properties are left completely alone', () => {
    const result = rotateState({ growth: 3, color: 'red' }, 1, 'x')
    assert.deepEqual(result.state, { growth: 3, color: 'red' })
    assert.deepEqual(result.unhandled, [])
})

test('rotating the reference room reports nothing unhandled', () => {
    for (const orientation of ORIENTATIONS) {
        const { unhandled } = rotateModule(testRoom(), orientation)
        assert.equal(unhandled.size, 0, `${orientation.label}: ${[...unhandled.keys()].join(', ')}`)
    }
})

// --- integration -----------------------------------------------------------

test('rotated modules still validate and compile to .mcstructure', () => {
    const original = testRoom()
    for (const orientation of ORIENTATIONS) {
        const module = rot(original, orientation.turns, orientation.mirror)
        assert.deepEqual(validateModule(module), [], `${orientation.label} failed validation`)

        const bytes = writeMcStructure(moduleToModel(module, { style: brownstone() }))
        assert.ok(bytes.length > 0)
    }
})

test('rotation is pure — the input module is never mutated', () => {
    const original = testRoom()
    const snapshot = JSON.stringify(original)
    rotateModule(original, { turns: 3, mirror: 'x' })
    assert.equal(JSON.stringify(original), snapshot)
})

test('invalid orientations are rejected', () => {
    assert.throws(() => rotateModule(testRoom(), { turns: 4 }), /turns must be 0-3/)
    assert.throws(() => rotateModule(testRoom(), { turns: 1.5 }), /turns must be 0-3/)
    assert.throws(() => rotateModule(testRoom(), { mirror: 'y' }), /mirror must be/)
})

// --- table hygiene ---------------------------------------------------------

test('the table declares a confidence level for every property', () => {
    for (const [name, spec] of Object.entries(TABLE.properties)) {
        assert.ok(['high', 'medium', 'low'].includes(spec.confidence), `${name} has confidence "${spec.confidence}"`)
        assert.ok(spec.semantic, `${name} has no semantic`)
    }
})

test('properties needing in-game measurement are enumerable', () => {
    const pending = lowConfidenceProperties()
    // This is not an assertion about how many — it is a guard that the report
    // works, so the probe can be generated from it.
    assert.ok(Array.isArray(pending))
    for (const entry of pending) {
        assert.ok(entry.name && entry.confidence)
    }
    const names = pending.map((entry) => entry.name)
    assert.ok(names.includes('direction'), 'the trapdoor/door `direction` risk must stay flagged until measured')
})
