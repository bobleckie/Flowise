/**
 * Street kit and district tile tests (SPEC.md M9, M11).
 *
 * The failure modes here are geometric and silent: a kerb that does not appear
 * because the band behind it happens to be grass, a marking that lands two
 * blocks wide, a cross street whose furniture all faces the wrong way after the
 * quarter turn, a building stamped through the alley.
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
import {
    generateStreet, generateIntersection, crossSection, streetType, rowWidth, markingFor, getStreets
} from '../lib/street.mjs'
import { generateDistrict, tileSize, GRADE } from '../lib/district.mjs'
import { isKnownBlock } from '../lib/blocks.mjs'
import { validateModule } from '../lib/module-format.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const TILES = JSON.parse(readFileSync(join(ROOT, 'data', 'districts', 'chicago.json'), 'utf8')).tiles
const TYPES = Object.keys(getStreets().types)

const catalog = new Map(loadCatalog().map((entry) => [entry.id, entry]))
const cache = new Map()
const buildFor = (id) => {
    if (!cache.has(id)) {
        const entry = catalog.get(id)
        cache.set(id, entry ? generateBuilding(entry, { shellOnly: true }) : null)
    }
    return cache.get(id)
}

test('every street type generates a valid module', () => {
    for (const name of TYPES) {
        const module = generateStreet(name, { length: 24 })
        assert.deepEqual(validateModule(module), [], `${name} generated an invalid module`)
        assert.equal(module.footprint[0], rowWidth(streetType(name)), `${name}: width is not its right of way`)
        assert.ok(module.blocks.length > 0, `${name} generated nothing`)
    }
})

test('the declared right of way matches the bands that make it up', () => {
    for (const [name, type] of Object.entries(getStreets().types)) {
        const summed = type.bands.reduce((total, band) => total + band.width, 0)
        assert.equal(summed, type.row, `${name}: bands sum to ${summed}, row says ${type.row}`)
    }
})

test('every block a street places is colour-mapped', () => {
    for (const name of TYPES) {
        for (const block of generateStreet(name, { length: 24 }).blocks) {
            assert.ok(isKnownBlock(block.block), `${name} places unmapped block ${block.block}`)
        }
    }
    for (const block of generateIntersection('arterial', 'commercial').blocks) {
        assert.ok(isKnownBlock(block.block), `intersection places unmapped block ${block.block}`)
    }
})

test('a roadway has a centre line, and exactly one column of it', () => {
    // Two adjacent yellow blocks read as one two-metre stripe down the middle
    // of the road. The double-yellow texture already carries both lines.
    for (const name of ['residential', 'commercial', 'arterial']) {
        const columns = crossSection(streetType(name)).filter((c) => c.kind === 'roadway')
        const centre = columns.filter((c) => ['center', 'double'].includes(markingFor(c)))
        assert.equal(centre.length, 1, `${name}: ${centre.length} centre-line columns`)
    }
})

test('every roadway edge has a kerb, whatever band lies behind it', () => {
    // A residential street has a planted parkway between kerb and pavement, and
    // treating the kerb as a sidewalk feature left those streets kerbless.
    for (const name of TYPES) {
        const type = streetType(name)
        const columns = crossSection(type)
        const roadways = columns.filter((c) => c.kind === 'roadway')
        if (!roadways.length || roadways.length === columns.length) continue

        const module = generateStreet(name, { length: 8 })
        const kerbs = new Set(module.blocks.filter((b) => b.block === 'cb:curb').map((b) => b.pos[0]))

        for (const [i, column] of columns.entries()) {
            const abuts = columns[i - 1]?.kind === 'roadway' || columns[i + 1]?.kind === 'roadway'
            if (column.kind !== 'roadway' && abuts) {
                assert.ok(kerbs.has(column.x), `${name}: no kerb at x=${column.x}`)
            }
        }
    }
})

test('a street is lit, and the light stands on the kerb, not in a tree', () => {
    for (const name of ['residential', 'commercial', 'arterial']) {
        const module = generateStreet(name, { length: 40 })
        const lights = module.blocks.filter((b) => b.block === 'cb:street_light')
        assert.ok(lights.length >= 2, `${name}: only ${lights.length} lights in 40 blocks`)

        const canopy = new Set(
            module.blocks.filter((b) => b.block === 'minecraft:oak_leaves').map((b) => b.pos.join(','))
        )
        for (const light of lights) {
            assert.ok(!canopy.has(light.pos.join(',')), `${name}: a light is inside a tree canopy`)
        }
    }
})

test('furniture spacing carries across consecutive segments', () => {
    // Two 20-block runs of the same street must look like one 40-block run, or
    // the rhythm restarts at every tile boundary.
    const whole = generateStreet('commercial', { length: 40 })
    const first = generateStreet('commercial', { length: 20, offset: 0 })
    const second = generateStreet('commercial', { length: 20, offset: 20 })

    const lightsIn = (module, shift = 0) =>
        module.blocks
            .filter((b) => b.block === 'cb:street_light')
            .map((b) => `${b.pos[0]},${b.pos[2] + shift}`)
            .sort()

    assert.deepEqual([...lightsIn(first), ...lightsIn(second, 20)].sort(), lightsIn(whole))
})

test('an intersection is crossable in both directions', () => {
    const module = generateIntersection('arterial', 'commercial')
    const crossings = module.blocks.filter((b) => b.state?.['cb:marking'] === 'crossing')
    const stops = module.blocks.filter((b) => b.state?.['cb:marking'] === 'stop')
    const signals = module.blocks.filter((b) => b.block === 'cb:traffic_signal')

    assert.ok(crossings.length > 0, 'no crossings')
    assert.ok(stops.length > 0, 'no stop bars')
    assert.equal(signals.length, 8, `expected two signal heads on each of four corners, got ${signals.length}`)

    const directions = new Set(crossings.map((b) => b.state['minecraft:cardinal_direction']))
    assert.equal(directions.size, 4, `crossings face ${[...directions].join(', ')}`)
})

test('every district tile generates, fits its declared size and holds buildings', () => {
    for (const [key, plan] of Object.entries(TILES)) {
        const module = generateDistrict(plan, buildFor)
        assert.deepEqual(validateModule(module), [], `${key} generated an invalid module`)

        const [width, depth] = tileSize(plan)
        assert.deepEqual(
            [module.footprint[0], module.footprint[2]], [width, depth],
            `${key}: footprint does not match tileSize`
        )
        assert.ok(module.contents.length >= 4, `${key}: only ${module.contents.length} buildings on the block`)
    }
})

test('no district building stands in the alley or in the street', () => {
    for (const [key, plan] of Object.entries(TILES)) {
        const module = generateDistrict(plan, buildFor)
        const westWidth = rowWidth(streetType(plan.west_street))
        const northWidth = rowWidth(streetType(plan.north_street))
        const alleyFrom = northWidth + plan.lot_depth
        const alleyTo = alleyFrom + plan.alley

        for (const placed of module.contents) {
            const module_ = buildFor(placed.id)
            const [w, , d] = module_.footprint
            const [x, , z] = placed.at

            assert.ok(x >= westWidth, `${key}: ${placed.id} stands in the west street`)
            assert.ok(z >= northWidth, `${key}: ${placed.id} stands in the north street`)
            assert.ok(x + w <= module.footprint[0], `${key}: ${placed.id} overhangs the tile`)
            assert.ok(z + d <= module.footprint[2], `${key}: ${placed.id} overhangs the tile`)

            const overlapsAlley = z < alleyTo && z + d > alleyFrom
            assert.ok(!overlapsAlley, `${key}: ${placed.id} is built across the alley`)
        }
    }
})

test('buildings on a tile do not overlap each other', () => {
    for (const [key, plan] of Object.entries(TILES)) {
        const module = generateDistrict(plan, buildFor)
        const boxes = module.contents.map((placed) => {
            const [w, , d] = buildFor(placed.id).footprint
            return { id: placed.id, x: placed.at[0], z: placed.at[2], w, d }
        })

        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]
                const b = boxes[j]
                const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d
                assert.ok(!overlap, `${key}: ${a.id} and ${b.id} occupy the same ground`)
            }
        }
    }
})

test('a tile stands its buildings on the pavement, not in it', () => {
    const plan = TILES.near_north_residential
    const module = generateDistrict(plan, buildFor)
    const byPos = new Map(module.blocks.map((b) => [b.pos.join(','), b]))

    for (const placed of module.contents.slice(0, 4)) {
        const [x, y, z] = placed.at
        assert.equal(y, GRADE, `${placed.id} is not at grade`)
        // The pavement course must exist directly under the building's corner.
        const under = byPos.get(`${x + 1},${GRADE - 1},${z + 1}`)
        assert.ok(under, `${placed.id} has nothing under it`)
    }
})

test('the cross street turns its furniture with it', () => {
    // A quarter turn that moves positions but not cardinal directions leaves
    // every kerb, light and meter on the cross street facing across the road.
    const plan = TILES.near_north_residential
    const module = generateDistrict(plan, buildFor)
    const northWidth = rowWidth(streetType(plan.north_street))

    const onNorthStreet = module.blocks.filter(
        (b) => b.pos[2] < northWidth && b.block === 'cb:curb' && b.pos[0] > 40
    )
    assert.ok(onNorthStreet.length > 0, 'the north street has no kerb')
    for (const kerb of onNorthStreet) {
        const facing = kerb.state?.['minecraft:cardinal_direction']
        assert.ok(
            facing === 'east' || facing === 'west',
            `a kerb on the east-west street faces ${facing}`
        )
    }
})
