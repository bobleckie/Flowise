/**
 * Transit tests (SPEC.md M10).
 *
 * The things that go wrong here are all about the relationship between the line
 * and the street it serves: a structure wider than the road it stands in, a
 * deck with no headroom under it, a tunnel that surfaces through the
 * carriageway, a station with no way in from the pavement.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import '../lib/streets.mjs'
import '../lib/transit-data.mjs'
import { crossSection, rowWidth, streetType } from '../lib/street.mjs'
import {
    generateElevated, generateSubway, streetcarOverlay, getTransit, transitLine, DECK_Y, TUNNEL_DEPTH
} from '../lib/transit.mjs'
import { isKnownBlock } from '../lib/blocks.mjs'
import { validateModule } from '../lib/module-format.mjs'

const LINES = Object.entries(getTransit().lines)

const build = (name, line, opts = {}) =>
    line.kind === 'subway' ? generateSubway(name, opts.id, { length: 48, ...opts })
    : line.kind === 'streetcar' ? streetcarOverlay(name, opts.id, { length: 48 })
    : generateElevated(name, opts.id, { length: 48, ...opts })

test('every transit line generates a valid module', () => {
    for (const [id, line] of LINES) {
        const module = build('arterial', line, { id })
        assert.deepEqual(validateModule(module), [], `${id} generated an invalid module`)
        assert.ok(module.blocks.length > 0, `${id} generated nothing`)
        assert.equal(module.footprint[0], rowWidth(streetType('arterial')), `${id}: not the width of its street`)
    }
})

test('every block transit places is colour-mapped', () => {
    for (const [id, line] of LINES) {
        for (const block of build('arterial', line, { id, station: true }).blocks) {
            assert.ok(isKnownBlock(block.block), `${id} places unmapped block ${block.block}`)
        }
    }
})

test('an elevated structure stands in the roadway, not on the pavement', () => {
    for (const [id, line] of LINES.filter(([, l]) => l.kind === 'elevated')) {
        const module = generateElevated('arterial', id, { length: 24 })
        const roadway = crossSection(streetType('arterial')).filter((c) => c.kind === 'roadway')
        const from = roadway[0].x
        const to = roadway[roadway.length - 1].x

        const columns = module.blocks.filter((b) => b.block === 'cb:lattice_column')
        assert.ok(columns.length > 0, `${id}: no columns`)
        for (const column of columns) {
            assert.ok(column.pos[0] >= from && column.pos[0] <= to, `${id}: a column stands outside the roadway`)
        }
    }
})

test('an elevated line leaves the street usable underneath it', () => {
    // The deck has to clear traffic, and the structure must not roof the whole
    // right of way — an L that covers the road makes the block below a tunnel.
    const module = generateElevated('arterial', 'loop_elevated', { length: 24 })
    const width = module.footprint[0]

    for (const block of module.blocks) {
        const [, y] = block.pos
        if (y > 0 && y < DECK_Y - 1) {
            assert.equal(block.block, 'cb:lattice_column', `something other than a column is at y=${y}`)
        }
    }

    const deck = new Set(module.blocks.filter((b) => b.pos[1] === DECK_Y).map((b) => b.pos[0]))
    assert.ok(deck.size < width * 0.75, `the deck covers ${deck.size} of ${width} columns of the street`)
})

test('an elevated station can be reached from the pavement', () => {
    const module = generateElevated('arterial', 'loop_elevated', { length: 48, station: true })
    const stair = module.blocks.filter((b) => b.block === 'minecraft:iron_block')
    assert.ok(stair.length > 0, 'the station has no stair')

    const heights = stair.map((b) => b.pos[1])
    assert.ok(Math.min(...heights) <= 2, 'the stair does not reach the pavement')
    assert.ok(Math.max(...heights) >= DECK_Y, 'the stair does not reach the deck')

    assert.ok(
        module.blocks.some((b) => b.block === 'cb:transit_sign'),
        'the station is unnamed'
    )
    assert.ok(
        module.blocks.some((b) => b.block === 'cb:turnstile'),
        'the station has no fare gates'
    )
})

test('a subway stays under the street, breaking it only at the kiosk', () => {
    const module = generateSubway('arterial', 'red_subway', { length: 48, station: true })
    assert.equal(module.grade, TUNNEL_DEPTH, 'the subway does not report where the street sits')

    // The pavement surface is one course above the datum. Nothing structural
    // may appear at or above it except the kiosk's own surround and railings —
    // the stair's top tread lands at the datum itself, under the paving.
    const above = module.blocks.filter((b) => b.pos[1] > module.grade && b.block !== 'minecraft:air')
    for (const block of above) {
        assert.ok(
            ['cb:handrail', 'cb:transit_sign', 'cb:station_tile'].includes(block.block),
            `${block.block} surfaces through the street at y=${block.pos[1]}`
        )
    }

    // And the opening itself must be narrow — a trench across the carriageway
    // is what happens when the passage is carved at street level.
    const openings = module.blocks.filter((b) => b.pos[1] === module.grade + 1 && b.block === 'minecraft:air')
    const columns = new Set(openings.map((b) => b.pos[0]))
    assert.ok(columns.size <= 4, `the kiosk opening is ${columns.size} blocks wide`)
})

test('a subway kiosk lands on the pavement, not in the road', () => {
    const module = generateSubway('arterial', 'red_subway', { length: 48, station: true })
    const columns = crossSection(streetType('arterial'))
    const roadway = new Set(columns.filter((c) => c.kind === 'roadway').map((c) => c.x))

    const openings = module.blocks.filter((b) => b.pos[1] === module.grade + 1 && b.block === 'minecraft:air')
    assert.ok(openings.length > 0, 'the station has no way out')
    for (const opening of openings) {
        assert.ok(!roadway.has(opening.pos[0]), 'the kiosk opens in the carriageway')
    }
})

test('a subway station has a platform, gates and a lit passage', () => {
    const module = generateSubway('arterial', 'red_subway', { length: 48, station: true })
    assert.ok(module.blocks.some((b) => b.block === 'cb:turnstile'), 'no fare gates')
    assert.ok(module.blocks.some((b) => b.block === 'cb:transit_sign'), 'no station name')
    assert.ok(
        module.blocks.filter((b) => b.block === 'cb:ceiling_light').length >= 4,
        'the tunnel is unlit'
    )
    assert.ok(
        module.blocks.filter((b) => b.block === 'minecraft:rail').length > 40,
        'the tunnel has no track'
    )
})

test('streetcar track is laid in the carriageway', () => {
    const module = streetcarOverlay('commercial', 'streetcar', { length: 40 })
    const roadway = new Set(
        crossSection(streetType('commercial')).filter((c) => c.kind === 'roadway').map((c) => c.x)
    )
    const rails = module.blocks.filter((b) => b.block === 'minecraft:rail')
    assert.ok(rails.length > 0, 'no track')
    for (const rail of rails) {
        assert.ok(roadway.has(rail.pos[0]), 'track laid outside the carriageway')
        assert.equal(rail.pos[1], 0, 'track is not at road level')
    }
    assert.ok(module.blocks.some((b) => b.block === 'cb:catenary'), 'no overhead')
})

test('a line runs on the number of tracks it declares', () => {
    for (const [id, line] of LINES) {
        const module = build('arterial', line, { id })
        const perZ = new Map()
        for (const rail of module.blocks.filter((b) => b.block === 'minecraft:rail')) {
            const z = rail.pos[2]
            perZ.set(z, (perZ.get(z) ?? 0) + 1)
        }
        const counts = new Set(perZ.values())
        assert.deepEqual([...counts], [transitLine(id).tracks], `${id}: track count varies along the line`)
    }
})
