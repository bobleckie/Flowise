/**
 * Runtime bundle tests.
 *
 * The behaviour pack generates buildings in-game from the same generator source
 * the build tools use. That only holds if the bundle stays in step, so these
 * tests prove parity without a game:
 *
 *   - every pack script parses
 *   - no bundled module imports a `node:` builtin (Bedrock would fail to load)
 *   - the bundled generator produces byte-identical geometry to the build-time one
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import '../lib/materials.mjs'
import { loadCatalog } from '../lib/catalog.mjs'
import { generateBuilding } from '../lib/generate.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SCRIPTS = join(ROOT, 'packs', 'city_builder_bp', 'scripts')
const LIB = join(SCRIPTS, 'lib')

function scriptFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scriptFiles(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []
    )
}

test('the runtime bundle exists — run `node tools/build-runtime.mjs`', () => {
    for (const name of ['catalog_data.js', 'generate.js', 'interior.js']) {
        assert.ok(existsSync(join(LIB, name)), `packs/.../scripts/lib/${name} is missing`)
    }
})

test('every behaviour pack script parses', () => {
    for (const file of scriptFiles(SCRIPTS)) {
        execFileSync(process.execPath, ['--check', file])
    }
})

test('no bundled module imports a node: builtin', () => {
    // Bedrock's script engine has no Node builtins; one of these would make the
    // whole pack fail to load, with a stack trace only visible in the Content Log.
    for (const file of scriptFiles(SCRIPTS)) {
        const source = readFileSync(file, 'utf8')
        assert.ok(!/from ['"]node:/.test(source), `${file} imports a node: builtin`)
    }
})

test('bundled scripts only import modules that exist', () => {
    for (const file of scriptFiles(SCRIPTS)) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
            const target = join(dirname(file), match[1])
            assert.ok(existsSync(target), `${file} imports missing ${match[1]}`)
        }
    }
})

test('the bundle carries every catalog preset', async () => {
    const { CATALOG, MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    const catalog = loadCatalog()

    assert.equal(CATALOG.length, catalog.length, 'bundle is out of date — re-run build-runtime.mjs')
    assert.deepEqual(
        CATALOG.map((e) => e.id).sort(),
        catalog.map((e) => e.id).sort()
    )
    for (const entry of CATALOG) {
        assert.ok(MATERIAL_SYSTEMS[entry.facade.system], `${entry.id}: bundle lacks its facade system`)
    }
})

test('the bundled generator matches the build-time generator exactly', async () => {
    // Same source, so any divergence means the bundle is stale.
    const runtime = await import(join(LIB, 'generate.js'))
    const { CATALOG, MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    runtime.setMaterials(MATERIAL_SYSTEMS)

    const catalog = loadCatalog()
    for (const id of ['monadnock_masonry_slab', 'chicago_bungalow', 'willis_bundled_tube', 'gas_station_canopy']) {
        const expected = generateBuilding(catalog.find((e) => e.id === id))
        const actual = runtime.generateBuilding(CATALOG.find((e) => e.id === id))

        assert.deepEqual(actual.footprint, expected.footprint, `${id}: footprint differs`)
        assert.equal(actual.blocks.length, expected.blocks.length, `${id}: block count differs`)
        assert.equal(JSON.stringify(actual.blocks), JSON.stringify(expected.blocks), `${id}: geometry differs`)
    }
})

test('the bundle is small enough to ship', () => {
    const total = ['catalog_data.js', 'generate.js', 'interior.js'].reduce(
        (sum, name) => sum + readFileSync(join(LIB, name)).length,
        0
    )
    // The whole point of generating in-game is avoiding megabytes of structures.
    assert.ok(total < 512 * 1024, `runtime bundle is ${(total / 1024).toFixed(0)} KB`)
})

test('placement time stays within the tick budget', async () => {
    const { CATALOG } = await import(join(LIB, 'catalog_data.js'))
    const runtime = await import(join(LIB, 'generate.js'))
    const { MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    runtime.setMaterials(MATERIAL_SYSTEMS)

    const budget = 400 // blocks per tick, SPEC.md §4.4
    const worst = CATALOG.map((entry) => ({
        id: entry.id,
        blocks: runtime.generateBuilding(entry).blocks.length
    })).sort((a, b) => b.blocks - a.blocks)[0]

    const seconds = worst.blocks / budget / 20
    // A build the player has to watch for minutes is a usability failure, not
    // a correctness one — but it should still be flagged before it ships.
    assert.ok(seconds < 300, `${worst.id} would take ${seconds.toFixed(0)}s to place at ${budget} blocks/tick`)
})

// --- placement planning ----------------------------------------------------

/** Mirrors placer.js's run-collapsing, so the two cannot drift apart silently. */
function planPlacement(blocks) {
    const AIR = 'minecraft:air'
    const sorted = blocks.slice().sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])
    const runs = []
    let run = null
    for (const block of sorted) {
        if (block.block !== AIR) {
            run = null
            continue
        }
        const [x, y, z] = block.pos
        if (run && run.y === y && run.x === x && z === run.z1 + 1) {
            run.z1 = z
            run.length++
        } else {
            run = { x, y, z0: z, z1: z, length: 1 }
            runs.push(run)
        }
    }
    return { runs, solids: sorted.filter((b) => b.block !== AIR), sorted }
}

test('collapsing air into runs loses nothing', async () => {
    const runtime = await import(join(LIB, 'generate.js'))
    const { CATALOG, MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    runtime.setMaterials(MATERIAL_SYSTEMS)

    for (const id of ['loop_greystone_commercial', 'chicago_bungalow', 'aon_white_shaft']) {
        const blocks = runtime.generateBuilding(CATALOG.find((e) => e.id === id)).blocks
        const { runs, solids, sorted } = planPlacement(blocks)

        const covered = runs.reduce((sum, r) => sum + r.length, 0)
        const air = sorted.filter((b) => b.block === 'minecraft:air').length
        assert.equal(covered + solids.length, sorted.length, `${id}: run collapse lost blocks`)
        assert.equal(covered, air, `${id}: runs do not cover every air block`)

        // Every run must be a genuine contiguous line, or fillBlocks would
        // clear cells that were never meant to be cleared.
        const airSet = new Set(sorted.filter((b) => b.block === 'minecraft:air').map((b) => b.pos.join(',')))
        for (const r of runs.slice(0, 200)) {
            for (let z = r.z0; z <= r.z1; z++) {
                assert.ok(airSet.has(`${r.x},${r.y},${z}`), `${id}: run covers a non-air cell at ${r.x},${r.y},${z}`)
            }
        }
    }
})

test('doors are always placed after their supporting blocks', async () => {
    // Placement is bottom-up; a door's upper half set before its lower half pops
    // both off in-game.
    const runtime = await import(join(LIB, 'generate.js'))
    const { CATALOG, MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    runtime.setMaterials(MATERIAL_SYSTEMS)

    const { solids } = planPlacement(runtime.generateBuilding(CATALOG.find((e) => e.id === 'loop_greystone_commercial')).blocks)
    const seen = new Set()
    for (const block of solids) {
        if (block.block.endsWith('_door') && block.state?.upper_block_bit === true) {
            const below = `${block.pos[0]},${block.pos[1] - 1},${block.pos[2]}`
            assert.ok(seen.has(below), `door top at ${block.pos} placed before its bottom`)
        }
        seen.add(block.pos.join(','))
    }
})

test('the worst-case build is bearable at the default budget', async () => {
    const runtime = await import(join(LIB, 'generate.js'))
    const { CATALOG, MATERIAL_SYSTEMS } = await import(join(LIB, 'catalog_data.js'))
    runtime.setMaterials(MATERIAL_SYSTEMS)

    let worst = { id: null, seconds: 0 }
    for (const entry of CATALOG) {
        const { runs, solids } = planPlacement(runtime.generateBuilding(entry).blocks)
        const seconds = (solids.length + runs.length * 4) / 400 / 20
        if (seconds > worst.seconds) worst = { id: entry.id, seconds }
    }
    assert.ok(worst.seconds < 90, `${worst.id} takes ${worst.seconds.toFixed(0)}s at 400 blocks/tick`)
})
