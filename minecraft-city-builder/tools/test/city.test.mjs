/**
 * City assembler tests (SPEC.md M14).
 *
 * The failure mode a grid of tiles has is disagreement: a street 20 blocks wide
 * on one side and 30 on the other, tiles that overlap or leave a seam, a line
 * that stops at a tile boundary, an edge that ends in a building face rather
 * than a kerb.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import '../lib/materials.mjs'
import '../lib/streets.mjs'
import '../lib/transit-data.mjs'
import { loadCatalog } from '../lib/catalog.mjs'
import { generateBuilding } from '../lib/generate.mjs'
import { rowWidth, streetType } from '../lib/street.mjs'
import { tileSize } from '../lib/district.mjs'
import { generateCity, cityLayout, cellPlan } from '../lib/city.mjs'
import { isKnownBlock } from '../lib/blocks.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CITIES = JSON.parse(readFileSync(join(ROOT, 'data', 'cities', 'chicago.json'), 'utf8')).cities

const catalog = new Map(loadCatalog().map((entry) => [entry.id, entry]))
const cache = new Map()
const buildFor = (id) => {
    if (!cache.has(id)) {
        const entry = catalog.get(id)
        cache.set(id, entry ? generateBuilding(entry, { shellOnly: true }) : null)
    }
    return cache.get(id)
}

const cities = Object.entries(CITIES)

test('every city names tile kinds and buildings that exist', () => {
    for (const [name, plan] of cities) {
        for (const row of plan.cells) {
            for (const kind of row) {
                assert.ok(plan.tiles[kind], `${name}: cell references unknown tile kind "${kind}"`)
            }
        }
        for (const [kind, tile] of Object.entries(plan.tiles)) {
            for (const id of tile.buildings) {
                assert.ok(catalog.has(id), `${name}/${kind}: unknown building "${id}"`)
            }
        }
        assert.equal(plan.cells.length, plan.rows.length, `${name}: cell rows do not match the grid`)
        for (const row of plan.cells) {
            assert.equal(row.length, plan.columns.length, `${name}: cell columns do not match the grid`)
        }
    }
})

test('tiles tessellate: each cell exactly fills its slot in the grid', () => {
    for (const [name, plan] of cities) {
        const layout = cityLayout(plan)
        for (let r = 0; r < layout.rows.length; r++) {
            for (let c = 0; c < layout.columns.length; c++) {
                const [width, depth] = tileSize(cellPlan(plan, layout, r, c))
                assert.equal(width, layout.columns[c].width, `${name} r${r}c${c}: width does not fill its column`)
                assert.equal(depth, layout.rows[r].depth, `${name} r${r}c${c}: depth does not fill its row`)
            }
        }
    }
})

test('a street is the same width on both sides of itself', () => {
    // Every tile in a column takes its west street from the column, so this
    // cannot drift — but if the derivation is ever bypassed it drifts silently.
    for (const [name, plan] of cities) {
        const layout = cityLayout(plan)
        for (let c = 0; c < layout.columns.length; c++) {
            const widths = new Set(
                layout.rows.map((_, r) => rowWidth(streetType(cellPlan(plan, layout, r, c).west_street)))
            )
            assert.equal(widths.size, 1, `${name}: column ${c} disagrees about its street width`)
        }
    }
})

test('a city closes with a street on every edge', () => {
    for (const [name, plan] of cities) {
        const city = generateCity(plan, buildFor)
        const layout = cityLayout(plan)

        // The far edges must carry roadway, not a building face.
        const atX = city.blocks.filter((b) => b.pos[0] === layout.width - 2)
        const atZ = city.blocks.filter((b) => b.pos[2] === layout.depth - 2)
        assert.ok(
            atX.some((b) => b.block === 'cb:asphalt' || b.block === 'cb:road_line'),
            `${name}: the east edge is not a street`
        )
        assert.ok(
            atZ.some((b) => b.block === 'cb:asphalt' || b.block === 'cb:road_line'),
            `${name}: the south edge is not a street`
        )
    }
})

test('a city generates only mapped blocks and stays inside its footprint', () => {
    for (const [name, plan] of cities) {
        const city = generateCity(plan, buildFor)
        const [sx, sy, sz] = city.footprint
        for (const block of city.blocks) {
            const [x, y, z] = block.pos
            assert.ok(isKnownBlock(block.block), `${name}: unmapped block ${block.block}`)
            assert.ok(x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz, `${name}: block outside at ${block.pos}`)
        }
        assert.ok(city.contents.length >= plan.rows.length * plan.columns.length, `${name}: too few buildings`)
    }
})

test('a line declared along an avenue runs the whole avenue', () => {
    // An L that stops at a tile boundary is a bridge to nowhere.
    const plan = CITIES.loop
    const layout = cityLayout(plan)
    const line = plan.transit[0]

    for (let r = 0; r < layout.rows.length; r++) {
        const tile = cellPlan(plan, layout, r, line.at)
        assert.ok(tile.transit, `row ${r} of the avenue carries no line`)
        assert.equal(tile.transit.line, line.line)
        assert.equal(tile.transit.offset, layout.rows[r].z, `row ${r} restarts the structure's rhythm`)
    }
})

test('a city with a subway lifts every tile onto the same datum', () => {
    // A dug tile beside an undug one leaves a step in the pavement.
    const plan = {
        ...CITIES.near_north,
        id: 'test_mixed',
        transit: [{ line: 'red_subway', kind: 'subway', along: 'column', at: 0, stations: [0] }]
    }
    const city = generateCity(plan, buildFor)
    assert.ok(city.grade > 0, 'the city was not dug for its subway')

    // Every tile's pavement must land on one level.
    const paving = city.blocks.filter((b) => b.block === 'cb:paving' && b.state?.['cb:paving'] === 'concrete')
    const levels = new Set(paving.map((b) => b.pos[1]))
    assert.ok(levels.has(city.grade + 1), `no pavement at the city datum (levels: ${[...levels].join(', ')})`)
})
