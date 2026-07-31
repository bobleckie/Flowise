/**
 * Catalog tests (SPEC.md M8) and the Bedrock vertical envelope.
 *
 * The envelope tests are the important ones: Bedrock's build range is fixed and
 * cannot be extended by an add-on, so whether a city is buildable at all is
 * arithmetic. Getting it wrong is discovered at the top of a tower, in-game,
 * after everything downstream has been built on the assumption.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    loadCatalog, validateCatalog, validateEntry, heightClassOf,
    heightAboveGrade, depthBelowGrade, HEIGHT_CLASSES, TYPES, ROOM_TYPES
} from '../lib/catalog.mjs'
import { solveEnvelope, maxFloors, WORLD_HEIGHT, WORLD_MIN, WORLD_MAX, DEFAULT_SUBSURFACE } from '../lib/envelope.mjs'

const catalog = loadCatalog()

// --- the catalog itself ----------------------------------------------------

test('the whole catalog validates', () => {
    assert.deepEqual(validateCatalog(catalog), [])
})

test('the catalog meets the v1 size and breadth targets', () => {
    assert.ok(catalog.length >= 50, `catalog has ${catalog.length} entries, target is 50+`)

    // Every height class needs real depth, or "varied sizes" is a claim rather
    // than a fact.
    for (const cls of HEIGHT_CLASSES) {
        const n = catalog.filter((e) => heightClassOf(e.massing.floors) === cls.id).length
        assert.ok(n >= 6, `${cls.label} has only ${n} entries, target is 6+`)
    }
})

test('every declared building type is represented', () => {
    for (const type of TYPES) {
        assert.ok(catalog.some((e) => e.type === type), `no catalog entry of type "${type}"`)
    }
})

test('ids are unique across every catalog file', () => {
    const seen = new Set()
    for (const entry of catalog) {
        assert.ok(!seen.has(entry.id), `duplicate id "${entry.id}" (${entry.source})`)
        seen.add(entry.id)
    }
})

test('every building has stairs, and anything tall has an elevator', () => {
    for (const entry of catalog) {
        assert.ok(entry.vertical.stairs >= 1, `${entry.id} has no stair`)
        if (entry.massing.floors >= 5) {
            const lifts = (entry.vertical.passenger_elevators ?? 0) + (entry.vertical.service_elevators ?? 0)
            assert.ok(lifts >= 1, `${entry.id} has ${entry.massing.floors} floors and no elevator`)
        }
    }
})

test('every floor of every building has a program', () => {
    // Already enforced by validateEntry, asserted here because "all the floors
    // are accounted for" is an explicit requirement, not an implementation detail.
    for (const entry of catalog) {
        const covered = new Set()
        for (const band of entry.program) {
            for (let n = band.floors[0]; n <= band.floors[1]; n++) covered.add(n)
        }
        assert.equal(covered.size, entry.massing.floors, `${entry.id}: ${covered.size} of ${entry.massing.floors} floors programmed`)
    }
})

test('every fitout maps to a known room type', () => {
    for (const entry of catalog) {
        for (const room of Object.keys(entry.fitout ?? {})) {
            assert.ok(ROOM_TYPES.includes(room), `${entry.id}: fitout key "${room}" is not a room type`)
        }
    }
})

test('every programmed use has a fitout, so no floor is left undressed', () => {
    const missing = []
    for (const entry of catalog) {
        const fitouts = new Set(Object.keys(entry.fitout ?? {}))
        for (const band of entry.program) {
            // Circulation and plant are dressed by the assembler, not per-building.
            if (['corridor', 'stair', 'elevator_lobby', 'mechanical', 'restroom'].includes(band.use)) continue
            if (!fitouts.has(band.use)) missing.push(`${entry.id}: "${band.use}" on floors ${band.floors.join('-')}`)
        }
    }
    assert.deepEqual(missing, [], `programmed uses with no fitout:\n  ${missing.join('\n  ')}`)
})

test('compressed floor counts are declared, never silent', () => {
    for (const entry of catalog) {
        const actual = entry.massing.floors_actual
        if (actual === undefined) continue
        assert.ok(actual > entry.massing.floors, `${entry.id}: floors_actual should only be set when compressing`)
    }
})

test('provenance is honest about distribution risk', () => {
    for (const entry of catalog) {
        const p = entry.provenance
        assert.ok(p.inspiration, `${entry.id} has no stated inspiration`)
        if (p.completed !== undefined) {
            assert.equal(p.pre1990, p.completed < 1990, `${entry.id}: pre1990 flag contradicts completion year`)
        }
        // Post-1990 named landmarks carry architectural copyright.
        if (p.named_landmark && p.completed >= 1990) {
            assert.equal(p.distribution, 'personal_only', `${entry.id} is a post-1990 named landmark but is not personal_only`)
        }
    }
})

// --- the envelope ----------------------------------------------------------

test('Bedrock world height is 384 blocks and that is not negotiable', () => {
    assert.equal(WORLD_HEIGHT, 384)
    assert.equal(WORLD_MAX - WORLD_MIN + 1, 384)
})

test('the entire catalog fits inside the Bedrock envelope', () => {
    const solved = solveEnvelope(catalog)
    assert.equal(
        solved.feasible,
        true,
        `does not fit:\n  ${solved.failures.map((f) => `${f.id} over by ${f.deficit}`).join('\n  ')}`
    )
})

test('the datum sits low enough for the deepest basement and the subway', () => {
    const solved = solveEnvelope(catalog)
    assert.ok(solved.datum >= WORLD_MIN, 'datum cannot be below the world floor')
    assert.ok(solved.below >= solved.deepest_basement, 'datum does not clear the deepest basement')
    // Digging down is the only lever there is, so it must be used fully.
    assert.ok(solved.datum - WORLD_MIN <= 40, 'datum is wastefully high — headroom is being thrown away')
})

test('4-block floors cannot reach 100 storeys, which is why tall towers use 3', () => {
    const solved = solveEnvelope(catalog)
    assert.ok(maxFloors(solved.headroom, 4) < 100, 'a 100-storey tower at 4 blocks/floor should not fit')
    assert.ok(maxFloors(solved.headroom, 3) >= 100, 'a 100-storey tower at 3 blocks/floor should fit')

    // And every supertall in the catalog must actually use the tighter height.
    for (const entry of catalog.filter((e) => e.massing.floors >= 60)) {
        assert.ok(entry.massing.floor_height <= 4, `${entry.id} is ${entry.massing.floors} floors at ${entry.massing.floor_height} blocks/floor`)
    }
})

test('a deeper subsurface budget buys no headroom once the datum hits the floor', () => {
    // Guards against a solver that silently digs below the world.
    const greedy = solveEnvelope(catalog, {
        subsurface: { foundation: 3, basements: 8, subway_mezzanine: 5, subway_tunnel: 200 }
    })
    assert.ok(greedy.datum <= WORLD_MAX)
    assert.ok(greedy.headroom < solveEnvelope(catalog).headroom, 'a bigger subsurface budget must cost headroom')
})

test('height and depth arithmetic is right', () => {
    const entry = {
        massing: { floors: 10, floor_height: 4, ground_floor_height: 6, roof: { type: 'flat_mechanical', height: 8, antennas: [{ height: 20 }] } },
        below_grade: { levels: 3, level_height: 5 }
    }
    const h = heightAboveGrade(entry)
    assert.equal(h.shaft, 6 + 9 * 4) // ground floor plus nine typical floors
    assert.equal(h.roofcap, 8)
    assert.equal(h.antenna, 20)
    assert.equal(h.total, 42 + 8 + 20)
    assert.equal(depthBelowGrade(entry), 15)
})

test('height class comes from floor count, with known edges', () => {
    assert.equal(heightClassOf(108), 'supertall')
    assert.equal(heightClassOf(60), 'supertall')
    assert.equal(heightClassOf(59), 'highrise')
    assert.equal(heightClassOf(20), 'highrise')
    assert.equal(heightClassOf(19), 'midrise')
    assert.equal(heightClassOf(7), 'midrise')
    assert.equal(heightClassOf(6), 'lowrise')
    assert.equal(heightClassOf(3), 'lowrise')
    assert.equal(heightClassOf(1), 'single_story')
})

// --- validator behaviour ---------------------------------------------------

const minimal = () => ({
    id: 'test_entry', name: 'Test', type: 'office', tier: 'monolithic',
    provenance: { inspiration: 'test', distribution: 'unrestricted', completed: 1980, pre1990: true },
    massing: { footprint: [10, 10], floors: 2, floor_height: 4, roof: { type: 'flat_parapet' } },
    vertical: { stairs: 1 },
    facade: { system: 'brick' },
    program: [{ floors: [1, 2], use: 'office_open' }]
})

test('the validator catches the mistakes that produce a broken building', () => {
    assert.deepEqual(validateEntry(minimal()), [])

    const gap = { ...minimal(), massing: { ...minimal().massing, floors: 5 } }
    assert.ok(validateEntry(gap).some((e) => /floors with no program/.test(e)))

    const overlap = { ...minimal(), program: [{ floors: [1, 2], use: 'office_open' }, { floors: [2, 2], use: 'lobby' }] }
    assert.ok(validateEntry(overlap).some((e) => /two program bands/.test(e)))

    const noStair = { ...minimal(), vertical: { stairs: 0 } }
    assert.ok(validateEntry(noStair).some((e) => /stairs must be at least 1/.test(e)))

    const tallNoLift = {
        ...minimal(),
        massing: { ...minimal().massing, floors: 10 },
        program: [{ floors: [1, 10], use: 'office_open' }],
        vertical: { stairs: 2 }
    }
    assert.ok(validateEntry(tallNoLift).some((e) => /no elevator/.test(e)))

    const badRoom = { ...minimal(), program: [{ floors: [1, 2], use: 'not_a_room' }] }
    assert.ok(validateEntry(badRoom).some((e) => /is not a known room type/.test(e)))

    const lyingYear = { ...minimal(), provenance: { ...minimal().provenance, completed: 2005, pre1990: true } }
    assert.ok(validateEntry(lyingYear).some((e) => /contradicts/.test(e)))

    const badLandmark = {
        ...minimal(),
        provenance: { inspiration: 'x', distribution: 'unrestricted', completed: 2005, pre1990: false, named_landmark: true }
    }
    assert.ok(validateEntry(badLandmark).some((e) => /cannot be distribution "unrestricted"/.test(e)))
})

test('a composed building is held to the module grid; a monolithic one is not', () => {
    const composed = {
        ...minimal(), tier: 'composed',
        massing: { ...minimal().massing, floor_height: 7 },
        structure: { bay: 5, core: { footprint: [4, 4] } }
    }
    assert.ok(validateEntry(composed).some((e) => /module grid/.test(e)))

    // The same 7-block floor is fine when the building is authored whole.
    const monolithic = { ...minimal(), massing: { ...minimal().massing, floor_height: 7 } }
    assert.deepEqual(validateEntry(monolithic), [])

    // A church nave really is 20 blocks.
    const nave = {
        ...minimal(),
        massing: { ...minimal().massing, floors: 1, floor_height: 20 },
        program: [{ floors: [1, 1], use: 'sanctuary' }]
    }
    assert.deepEqual(validateEntry(nave), [])
})

test('a cantilever must be declared, so a transposed footprint is still caught', () => {
    const base = {
        ...minimal(), tier: 'composed',
        structure: { bay: 5, core: { footprint: [4, 4] } },
        massing: { ...minimal().massing, floors: 6, setbacks: [{ at_floor: 3, footprint: [20, 20] }] },
        program: [{ floors: [1, 6], use: 'office_open' }],
        vertical: { stairs: 1, passenger_elevators: 1 }
    }
    assert.ok(validateEntry(base).some((e) => /inverted_profile/.test(e)))

    const declared = { ...base, massing: { ...base.massing, inverted_profile: true } }
    assert.deepEqual(validateEntry(declared), [])
})

test('setbacks must ascend, and stay inside the building', () => {
    const make = (setbacks) => ({
        ...minimal(), tier: 'composed', structure: { bay: 5, core: { footprint: [4, 4] } },
        massing: { ...minimal().massing, footprint: [30, 30], floors: 10, setbacks },
        program: [{ floors: [1, 10], use: 'office_open' }],
        vertical: { stairs: 1, passenger_elevators: 1 }
    })
    assert.ok(validateEntry(make([{ at_floor: 8, footprint: [20, 20] }, { at_floor: 4, footprint: [10, 10] }])).some((e) => /ascending/.test(e)))
    assert.ok(validateEntry(make([{ at_floor: 99, footprint: [20, 20] }])).some((e) => /outside 2\.\./.test(e)))
})
