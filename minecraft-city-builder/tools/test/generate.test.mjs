/**
 * Generator and palette tests (SPEC.md M3, M8).
 *
 * These check the two claims the premortem said were unproven: that the block
 * palette can actually carry 51 distinct facade systems, and that one
 * parameterized generator can produce every building in the catalog rather than
 * 357 hand-written ones.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import '../lib/materials.mjs' // binds the material palette into the generator
import { loadCatalog } from '../lib/catalog.mjs'
import { generateBuilding, floorPlates, totalHeight, facadeCell, windowSpec, verticalRegistry, WINDOW_FAMILIES, MATERIALS } from '../lib/generate.mjs'
import { validateModule, moduleToModel } from '../lib/module-format.mjs'
import { writeMcStructure } from '../lib/mcstructure.mjs'
import '../lib/rotation-table.mjs' // binds the rotation table
import { rotateModule, ORIENTATIONS } from '../lib/rotation.mjs'
import { isKnownBlock, colorOf, deltaE, SAME_MATERIAL_THRESHOLD } from '../lib/blocks.mjs'
import { renderIso } from '../lib/render.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const catalog = loadCatalog()

// --- palette ---------------------------------------------------------------

test('every catalog facade system binds to real blocks', () => {
    for (const entry of catalog) {
        const binding = MATERIALS[entry.facade.system]
        assert.ok(binding, `${entry.id}: facade system "${entry.facade.system}" has no binding`)
        for (const [role, block] of Object.entries(binding)) {
            assert.ok(isKnownBlock(block), `${entry.facade.system}.${role} -> unknown block "${block}"`)
        }
    }
})

test('every binding fills all six material roles', () => {
    for (const [name, binding] of Object.entries(MATERIALS)) {
        for (const role of ['wall', 'trim', 'accent', 'glass', 'frame', 'base']) {
            assert.ok(binding[role], `${name} is missing the "${role}" role`)
        }
    }
})

test('no two facade systems are indistinguishable', () => {
    // A colour collision is only real when nothing else separates the pair —
    // trim, accent and glazing all carry information too.
    const names = Object.keys(MATERIALS)
    const collisions = []

    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const a = MATERIALS[names[i]]
            const b = MATERIALS[names[j]]
            if (deltaE(colorOf(a.wall), colorOf(b.wall)) >= SAME_MATERIAL_THRESHOLD) continue

            const separated = ['trim', 'accent', 'glass'].some(
                (role) => deltaE(colorOf(a[role]), colorOf(b[role])) >= SAME_MATERIAL_THRESHOLD
            )
            if (!separated) collisions.push(`${names[i]} == ${names[j]}`)
        }
    }
    assert.deepEqual(collisions, [], `indistinguishable facade systems:\n  ${collisions.join('\n  ')}`)
})

// --- massing ---------------------------------------------------------------

test('floor plates cover every floor and honour setbacks', () => {
    for (const entry of catalog) {
        const plates = floorPlates(entry)
        assert.equal(plates.length, entry.massing.floors, `${entry.id}: plate count`)

        // Contiguous, no gaps or overlaps in height.
        let y = 0
        for (const plate of plates) {
            assert.equal(plate.base, y, `${entry.id}: floor ${plate.floor} starts at the wrong height`)
            y += plate.height
        }

        // Every setback takes effect on the floor it names and persists upward.
        for (const setback of entry.massing.setbacks ?? []) {
            const plate = plates.find((p) => p.floor === setback.at_floor)
            assert.deepEqual(plate.size, setback.footprint, `${entry.id}: setback at floor ${setback.at_floor}`)
        }
    }
})

test('the ground floor uses its own height when one is given', () => {
    const entry = catalog.find((e) => e.massing.ground_floor_height > e.massing.floor_height)
    const plates = floorPlates(entry)
    assert.equal(plates[0].height, entry.massing.ground_floor_height)
    assert.equal(plates[1].height, entry.massing.floor_height)
})

test('generated height matches the envelope solver', async () => {
    const { heightAboveGrade } = await import('../lib/catalog.mjs')
    for (const entry of catalog) {
        assert.equal(totalHeight(entry), heightAboveGrade(entry).total, `${entry.id}: height disagrees with the solver`)
    }
})

// --- facade ----------------------------------------------------------------

test('every catalog window pattern has a family', () => {
    for (const entry of catalog) {
        assert.ok(
            WINDOW_FAMILIES[entry.facade.window_pattern],
            `${entry.id}: window pattern "${entry.facade.window_pattern}" has no family`
        )
    }
})

test('33 window patterns reduce to a handful of families', () => {
    const families = new Set(Object.values(WINDOW_FAMILIES).map((s) => s.family))
    assert.ok(families.size <= 10, `${families.size} families is too many to be a reduction`)
    assert.ok(Object.keys(WINDOW_FAMILIES).length >= 30, 'all catalog patterns should be covered')
})

test('every facade family produces both glass and wall somewhere', () => {
    // A family that emits only wall makes a blank box; only glass makes a fishbowl.
    for (const [pattern, spec] of Object.entries(WINDOW_FAMILIES)) {
        if (spec.family === 'open') continue
        const seen = new Set()
        for (let u = 0; u < 20; u++) {
            for (let v = 0; v <= 4; v++) {
                seen.add(facadeCell(u, v, spec, { interiorHeight: 4, bay: 5, isGround: false }))
            }
        }
        assert.ok(seen.has('glass'), `${pattern} never emits glass`)
        assert.ok(seen.has('wall') || seen.has('frame') || seen.has('accent'), `${pattern} never emits solid`)
    }
})

test('the slab course is always solid, so floors read as floors', () => {
    for (const spec of Object.values(WINDOW_FAMILIES)) {
        for (let u = 0; u < 12; u++) {
            assert.equal(facadeCell(u, 0, spec, { interiorHeight: 3, bay: 5, isGround: false }), 'trim')
        }
    }
})

// --- whole buildings -------------------------------------------------------

test('every catalog entry generates a valid module', () => {
    for (const entry of catalog) {
        const module = generateBuilding(entry, { shellOnly: true })
        assert.deepEqual(validateModule(module), [], `${entry.id} generated an invalid module`)
        assert.ok(module.blocks.length > 0, `${entry.id} generated nothing`)
    }
})

test('no generated building is a featureless box', () => {
    // The premortem's failure mode: dimensionally correct, visually dead.
    for (const entry of catalog) {
        const module = generateBuilding(entry, { shellOnly: true })
        const distinct = new Set(module.blocks.map((b) => b.block))
        assert.ok(distinct.size >= 3, `${entry.id} uses only ${distinct.size} block types`)

        // Open-sided structures (car wash tunnels, parking decks) have
        // openings rather than glazing, and correctly have no glass at all.
        const glass = MATERIALS[entry.facade.system].glass
        const family = windowSpec(entry.facade.window_pattern).family
        if (glass !== 'minecraft:air' && family !== 'open') {
            const glazed = module.blocks.filter((b) => b.block === glass).length
            assert.ok(glazed > 0, `${entry.id} has no windows at all`)
        }
    }
})

test('generated blocks stay inside the declared footprint', () => {
    for (const entry of catalog) {
        const module = generateBuilding(entry, { shellOnly: true })
        const [sx, sy, sz] = module.footprint
        for (const block of module.blocks) {
            const [x, y, z] = block.pos
            assert.ok(x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz, `${entry.id}: block outside at ${block.pos}`)
        }
    }
})

test('generation is deterministic — the same entry always yields the same building', () => {
    // Roof clutter is pseudo-random; it must be seeded by the id, not by chance.
    const entry = catalog.find((e) => (e.massing.roof.features ?? []).length >= 2)
    const a = generateBuilding(entry, { shellOnly: true })
    const b = generateBuilding(entry, { shellOnly: true })
    assert.equal(JSON.stringify(a.blocks), JSON.stringify(b.blocks))
})

test('generated buildings compile to .mcstructure and survive rotation', () => {
    // One from each height class, to keep the test quick.
    // Full interiors, so the directional blocks that interiors introduce —
    // stairs, doors, lift doors — are exercised by the rotation engine.
    const sample = ['monadnock_masonry_slab', 'chicago_bungalow', 'gas_station_canopy', 'loop_greystone_commercial']
    for (const id of sample) {
        const entry = catalog.find((e) => e.id === id)
        const module = generateBuilding(entry)

        assert.ok(writeMcStructure(moduleToModel(module)).length > 0, `${id} failed to serialize`)

        for (const orientation of ORIENTATIONS) {
            const { module: turned, unhandled } = rotateModule(module, orientation)
            assert.equal(unhandled.size, 0, `${id} ${orientation.label}: unhandled ${[...unhandled.keys()]}`)
            assert.equal(turned.blocks.length, module.blocks.length, `${id} ${orientation.label}: lost blocks`)
            assert.deepEqual(validateModule(turned), [], `${id} ${orientation.label} invalid`)
        }
    }
})

test('roof features actually reach the roof', () => {
    const entry = catalog.find((e) => e.id === 'warehouse_loft')
    const module = generateBuilding(entry, { shellOnly: true })
    const roofBase = totalHeight(entry) - (entry.massing.roof.height ?? 0)
    const above = module.blocks.filter((b) => b.pos[1] >= roofBase)
    assert.ok(above.length > 0, 'nothing was placed on the roof')

    // The water tower is timber; a bare deck would have none.
    assert.ok(
        module.blocks.some((b) => b.block === 'minecraft:dark_oak_planks' && b.pos[1] >= roofBase - 2),
        'the declared water_tower feature was not built'
    )
})

test('buildings that exceed the structure-block limit are identifiable', () => {
    // Bedrock structure blocks cap at 64x384x64. Larger presets are legal but
    // must be placed by script, and the pipeline has to know which those are.
    const oversize = catalog.filter((e) => {
        const m = generateBuilding(e, { shellOnly: true })
        return m.footprint[0] > 64 || m.footprint[1] > 384 || m.footprint[2] > 64
    })
    assert.ok(oversize.length > 0, 'expected some large buildings')
    assert.ok(oversize.length < catalog.length, 'not everything should be oversize')
    for (const entry of oversize) {
        assert.ok(entry.massing.footprint[0] > 64 || entry.massing.footprint[1] > 64 || totalHeight(entry) > 384)
    }
})

// --- renderer --------------------------------------------------------------

test('the renderer produces a valid PNG', () => {
    const module = generateBuilding(catalog.find((e) => e.id === 'chicago_bungalow'), { shellOnly: true })
    const png = renderIso(module.blocks, { maxPixels: 200 }).toPng()

    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR')
    assert.ok(png.subarray(-8).toString('ascii').includes('IEND'))
})

test('the renderer draws something other than background', () => {
    const module = generateBuilding(catalog.find((e) => e.id === 'roadside_diner'), { shellOnly: true })
    const canvas = renderIso(module.blocks, { maxPixels: 200 })

    let painted = 0
    for (let i = 0; i < canvas.width * canvas.height; i++) {
        if (canvas.data[i * 3] !== 26 || canvas.data[i * 3 + 1] !== 28 || canvas.data[i * 3 + 2] !== 34) painted++
    }
    assert.ok(painted > canvas.width * canvas.height * 0.1, 'render is nearly empty')
})

// --- emitted blocks --------------------------------------------------------

test('every block the generator emits is colour-mapped', () => {
    // Unmapped blocks render magenta, which is loud but only visible if someone
    // looks. This catches it before anyone does — it already caught the whole
    // interior fittings set (stairs, doors, lanterns) rendering as magenta.
    const unmapped = new Set()
    for (const entry of catalog) {
        for (const block of generateBuilding(entry).blocks) {
            if (!isKnownBlock(block.block)) unmapped.add(`${block.block} (${entry.id})`)
        }
    }
    assert.deepEqual([...unmapped], [], `unmapped blocks:\n  ${[...unmapped].join('\n  ')}`)
})

test('interiors make every building enterable and climbable', () => {
    // A shell you cannot walk into or up is not a usable building.
    for (const entry of catalog) {
        const module = generateBuilding(entry)
        const blocks = module.blocks

        const doors = blocks.filter((b) => b.block.endsWith('_door'))
        assert.ok(doors.length >= 2, `${entry.id} has no entrance doors`)

        if (entry.massing.floors > 1) {
            const stairs = blocks.filter((b) => b.block.endsWith('_stairs'))
            assert.ok(stairs.length > 0, `${entry.id} is ${entry.massing.floors} floors with no stairs`)
        }

        const lights = blocks.filter((b) => b.block === 'minecraft:glowstone' || b.block === 'minecraft:lantern')
        assert.ok(lights.length > 0, `${entry.id} has no interior lighting`)

        // Hollowed volume: a solid building would have almost no air.
        const air = blocks.filter((b) => b.block === 'minecraft:air').length
        assert.ok(air > blocks.length * 0.15, `${entry.id} is only ${Math.round((air / blocks.length) * 100)}% air — not hollow`)
    }
})

test('doors and stairs carry the block states they need', () => {
    const module = generateBuilding(catalog.find((e) => e.id === 'loop_greystone_commercial'))
    for (const block of module.blocks) {
        if (block.block.endsWith('_door')) {
            assert.ok(block.state, `door at ${block.pos} has no state`)
            assert.equal(typeof block.state.upper_block_bit, 'boolean', 'door needs upper_block_bit')
            assert.equal(typeof block.state.direction, 'number', 'door needs direction')
        }
        if (block.block.endsWith('_stairs')) {
            assert.ok(block.state, `stair at ${block.pos} has no state`)
            assert.equal(typeof block.state.weirdo_direction, 'number', 'stair needs weirdo_direction')
        }
    }
})

test('every door has both halves', () => {
    // A door missing its upper half is a broken block in-game, not a short door.
    for (const entry of catalog) {
        const doors = generateBuilding(entry).blocks.filter((b) => b.block.endsWith('_door'))
        const lower = doors.filter((d) => d.state?.upper_block_bit === false).length
        const upper = doors.filter((d) => d.state?.upper_block_bit === true).length
        assert.equal(lower, upper, `${entry.id}: ${lower} door bottoms, ${upper} tops`)
    }
})


test('rotating a finished building keeps it enterable and climbable', () => {
    // Interiors introduce doors and stairs, which are the most rotation-sensitive
    // blocks in the game. A building that rotates into a sealed box is useless.
    for (const id of ['loop_greystone_commercial', 'chicago_bungalow', 'warehouse_loft']) {
        const module = generateBuilding(catalog.find((e) => e.id === id))
        const before = {
            doors: module.blocks.filter((b) => b.block.endsWith('_door')).length,
            stairs: module.blocks.filter((b) => b.block.endsWith('_stairs')).length
        }

        for (const turns of [1, 2, 3]) {
            const { module: turned, unhandled } = rotateModule(module, { turns })
            assert.equal(unhandled.size, 0, `${id} r${turns * 90}: unhandled ${[...unhandled.keys()]}`)
            assert.deepEqual(validateModule(turned), [], `${id} r${turns * 90} is invalid`)

            const doors = turned.blocks.filter((b) => b.block.endsWith('_door'))
            assert.equal(doors.length, before.doors, `${id} r${turns * 90}: lost doors`)
            assert.equal(
                turned.blocks.filter((b) => b.block.endsWith('_stairs')).length,
                before.stairs,
                `${id} r${turns * 90}: lost stairs`
            )

            // Door halves must stay paired after the transform.
            const lower = doors.filter((d) => d.state?.upper_block_bit === false).length
            assert.equal(lower * 2, doors.length, `${id} r${turns * 90}: door halves unpaired`)

            // Every stair must still face a legal direction.
            for (const stair of turned.blocks.filter((b) => b.block.endsWith('_stairs'))) {
                assert.ok(
                    [0, 1, 2, 3].includes(stair.state.weirdo_direction),
                    `${id} r${turns * 90}: stair facing ${stair.state.weirdo_direction}`
                )
            }
        }
    }
})


// --- elevators -------------------------------------------------------------

test('every building with a declared elevator gets a real shaft', () => {
    for (const entry of catalog) {
        const lifts = (entry.vertical.passenger_elevators ?? 0) + (entry.vertical.service_elevators ?? 0)
        const registry = verticalRegistry(entry)
        if (lifts === 0) continue

        assert.ok(registry.hasLift, `${entry.id} declares ${lifts} lifts but has no shaft`)
        assert.ok(registry.shaft.w >= 1 && registry.shaft.d >= 1, `${entry.id}: degenerate shaft`)
    }
})

test('the shaft sits inside the building and stops line up with floors', () => {
    for (const entry of catalog) {
        const registry = verticalRegistry(entry)
        const [bx, , bz] = [entry.massing.footprint[0], 0, entry.massing.footprint[1]]
        const plates = floorPlates(entry)

        assert.equal(registry.stops.length, entry.massing.floors, `${entry.id}: stop count`)
        registry.stops.forEach((stop, i) => {
            assert.equal(stop.floor, plates[i].floor, `${entry.id}: stop ${i} floor`)
            // A stop must be standing height above the slab, not inside it.
            assert.equal(stop.y, plates[i].base + 1, `${entry.id}: stop ${i} is not on the floor surface`)
        })

        // Stops must ascend, or the floor panel lists them out of order.
        for (let i = 1; i < registry.stops.length; i++) {
            assert.ok(registry.stops[i].y > registry.stops[i - 1].y, `${entry.id}: stops out of order`)
        }

        if (!registry.hasLift) continue
        const { x, z, w, d } = registry.shaft
        assert.ok(x >= 0 && x + w <= bx, `${entry.id}: shaft escapes the footprint in x`)
        assert.ok(z >= 0 && z + d <= bz, `${entry.id}: shaft escapes the footprint in z`)
    }
})

test('the shaft is actually hollow where the lift runs', () => {
    // A shaft full of blocks is a wall with a door on it.
    for (const id of ['loop_greystone_commercial', 'hotel_tower_convention', 'aon_white_shaft']) {
        const entry = catalog.find((e) => e.id === id)
        const registry = verticalRegistry(entry)
        assert.ok(registry.hasLift, `${id} should have a lift`)

        const solid = new Set(
            generateBuilding(entry)
                .blocks.filter((b) => b.block !== 'minecraft:air')
                .map((b) => b.pos.join(','))
        )

        // Check a mid-height stop: the cell a rider occupies must be clear.
        const stop = registry.stops[Math.floor(registry.stops.length / 2)]
        const { x, z } = registry.shaft
        for (const dy of [0, 1]) {
            assert.ok(!solid.has(`${x},${stop.y + dy},${z}`), `${id}: shaft blocked at floor ${stop.floor}`)
        }
    }
})
