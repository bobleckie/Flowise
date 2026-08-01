/**
 * Deferred block placement (SPEC.md M4).
 *
 * Buildings are generated in-game from the bundled catalog rather than shipped
 * as `.mcstructure` files — Willis Tower alone would be ~14 MB, and Bedrock
 * structure blocks cap at 64x384x64 so the large presets could not be placed
 * that way at all.
 *
 * Placement runs on a per-tick block budget so a 100-storey tower never stalls
 * the server. §4.4 sets that budget at 400 blocks per tick.
 */

import { system, world, BlockPermutation } from '@minecraft/server'
import { CATALOG, MATERIAL_SYSTEMS, ROTATION_TABLE, STREETS, DISTRICTS, TRANSIT, CITIES } from './lib/catalog_data.js'
import { generateBuilding, setMaterials, totalHeight, verticalRegistry } from './lib/generate.js'
import { setStreets } from './lib/street.js'
import { setTransit } from './lib/transit.js'
import { generateDistrict, tileSize } from './lib/district.js'
import { generateCity, cityLayout } from './lib/city.js'
import { rotateModule, setRotationTable } from './lib/rotation.js'
import { registerShaft, clearShaftsAt } from './elevator.js'

setMaterials(MATERIAL_SYSTEMS)
setRotationTable(ROTATION_TABLE)

const PREFIX = '§6[City Builder]§r'

/** §4.4 performance budget. Tunable at runtime through the Settings menu. */
export const BUDGET = { blocksPerTick: 400 }

/** One job at a time — two concurrent builds would blow the tick budget. */
let active = null

export function isBuilding() {
    return active !== null
}

export function cancelBuild() {
    if (!active) return false
    active.cancelled = true
    return true
}

export function catalogEntries() {
    return CATALOG
}

export function entryById(id) {
    return CATALOG.find((e) => e.id === id)
}

/**
 * Build a preset with its lowest north-west corner at `origin`.
 * @returns false when a build is already running
 */
export function placeBuilding(player, entry, origin, turns = 0) {
    if (active) {
        player.sendMessage(`${PREFIX} §ealready building ${active.entry.name} — cancel it first.§r`)
        return false
    }

    let module
    try {
        module = generateBuilding(entry)
        if (turns) {
            const rotated = rotateModule(module, { turns })
            module = rotated.module
            for (const property of rotated.unhandled.keys()) {
                console.warn(`[City Builder] ${entry.id}: "${property}" could not be rotated`)
            }
        }
    } catch (error) {
        player.sendMessage(`${PREFIX} §cgeneration failed:§r ${error}`)
        return false
    }

    // Sorted low to high so a door's lower half is always placed before its
    // upper half, and so nothing is set on top of an unsupported block.
    const sorted = module.blocks
        .slice()
        .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])

    // About 62% of a tall building is the hollowed-out interior. Clearing it
    // one block at a time is what makes a supertall take minutes, so contiguous
    // air is collapsed into runs and filled in bulk where the API allows it.
    const runs = airRuns(sorted)
    const solids = sorted.filter((b) => b.block !== AIR)

    active = {
        entry,
        player,
        dimension: player.dimension,
        origin,
        runs,
        runIndex: 0,
        blocks: solids,
        index: 0,
        total: sorted.length,
        placed: 0,
        failed: 0,
        deferred: [],
        lastReport: 0,
        cancelled: false,
        startTick: system.currentTick
    }

    lastPlacement.set(player.id, { entry, origin, footprint: module.footprint, turns })

    // Register the lift so the floor panel works the moment the building lands.
    // Rotation moves the shaft, so it is only registered for unrotated builds
    // until the registry itself is rotation-aware.
    if (!turns) {
        try {
            registerShaft(entry, verticalRegistry(entry), origin)
        } catch (error) {
            console.warn(`[City Builder] lift registration failed: ${error}`)
        }
    }

    player.sendMessage(
        `${PREFIX} building §a${entry.name}§r${turns ? ` (${turns * 90}°)` : ''} — ` +
            `${sorted.length.toLocaleString()} blocks, ${entry.massing.floors} floors, ` +
            `${totalHeight(entry)} blocks tall`
    )
    return true
}

// --- districts -------------------------------------------------------------
//
// A district tile is far past the 64x384x64 structure-block limit — the Loop
// tile is 150x160x124 — so like the buildings it is generated in game and fed
// through the same tick-budgeted placer.

setStreets(STREETS)
setTransit(TRANSIT)

export function districtEntries() {
    return Object.entries(DISTRICTS).map(([key, plan]) => ({ key, ...plan, size: tileSize(plan) }))
}

const buildingCache = new Map()
function buildingModule(id) {
    if (!buildingCache.has(id)) {
        const entry = entryById(id)
        buildingCache.set(id, entry ? generateBuilding(entry) : null)
    }
    return buildingCache.get(id)
}

export function placeDistrict(player, plan, origin) {
    if (active) {
        player.sendMessage(`${PREFIX} §ealready building ${active.entry.name} — cancel it first.§r`)
        return false
    }

    let module
    try {
        module = generateDistrict(plan, buildingModule)
    } catch (error) {
        player.sendMessage(`${PREFIX} §cdistrict generation failed:§r ${error}`)
        return false
    }

    const sorted = module.blocks
        .slice()
        .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])
    const runs = airRuns(sorted)
    const solids = sorted.filter((b) => b.block !== AIR)

    const entry = { id: plan.id, name: plan.name ?? plan.id, massing: { floors: 0 } }
    active = {
        entry,
        player,
        dimension: player.dimension,
        origin,
        runs,
        runIndex: 0,
        blocks: solids,
        index: 0,
        total: sorted.length,
        placed: 0,
        failed: 0,
        deferred: [],
        lastReport: 0,
        cancelled: false,
        startTick: system.currentTick
    }

    lastPlacement.set(player.id, { entry, origin, footprint: module.footprint, turns: 0 })

    player.sendMessage(
        `${PREFIX} laying §a${entry.name}§r — ${sorted.length.toLocaleString()} blocks, ` +
            `${module.footprint[0]}x${module.footprint[2]}, ${module.contents.length} buildings`
    )
    return true
}

// --- cities ----------------------------------------------------------------
//
// A city is a grid of district tiles. The Near North grid is a quarter of a
// million blocks before interiors, so it goes through the same placer — there
// is no other way to put it in a world.

export function cityEntries() {
    return Object.entries(CITIES).map(([key, plan]) => {
        const layout = cityLayout(plan)
        return { key, ...plan, size: [layout.width, layout.depth], blocks: plan.rows.length * plan.columns.length }
    })
}

export function placeCity(player, plan, origin) {
    if (active) {
        player.sendMessage(`${PREFIX} §ealready building ${active.entry.name} — cancel it first.§r`)
        return false
    }

    player.sendMessage(`${PREFIX} generating §a${plan.name}§r — this takes a moment before anything appears.`)

    let city
    try {
        city = generateCity(plan, buildingModule)
    } catch (error) {
        player.sendMessage(`${PREFIX} §ccity generation failed:§r ${error}`)
        return false
    }

    const sorted = city.blocks
        .slice()
        .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])
    const runs = airRuns(sorted)
    const solids = sorted.filter((b) => b.block !== AIR)

    const entry = { id: city.id, name: plan.name, massing: { floors: 0 } }
    active = {
        entry,
        player,
        dimension: player.dimension,
        origin,
        runs,
        runIndex: 0,
        blocks: solids,
        index: 0,
        total: sorted.length,
        placed: 0,
        failed: 0,
        deferred: [],
        lastReport: 0,
        cancelled: false,
        startTick: system.currentTick
    }

    lastPlacement.set(player.id, { entry, origin, footprint: city.footprint, turns: 0 })

    player.sendMessage(
        `${PREFIX} laying §a${plan.name}§r — ${sorted.length.toLocaleString()} blocks, ` +
            `${city.footprint[0]}x${city.footprint[2]}, ${city.contents.length} buildings`
    )
    return true
}

// --- undo ------------------------------------------------------------------
//
// Placing a million blocks with no way back is not usable. Rather than
// journalling every overwritten block — which for a supertall would be hundreds
// of megabytes — undo clears the volume the building occupied.

const lastPlacement = new Map()

export function lastPlacementFor(playerId) {
    return lastPlacement.get(playerId)
}

/** Clear the last building this player placed. Returns false if there is none. */
export function undoLast(player) {
    if (active) {
        player.sendMessage(`${PREFIX} §efinish or cancel the current build first.§r`)
        return false
    }
    const record = lastPlacement.get(player.id)
    if (!record) {
        player.sendMessage(`${PREFIX} nothing to undo.`)
        return false
    }

    const [sx, sy, sz] = record.footprint
    const blocks = []
    for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
            for (let z = 0; z < sz; z++) blocks.push({ pos: [x, y, z], block: AIR })
        }
    }

    lastPlacement.delete(player.id)
    clearShaftsAt(record.origin, record.footprint)
    const sorted = blocks
    active = {
        entry: { name: `Undo ${record.entry.name}`, massing: record.entry.massing },
        player,
        dimension: player.dimension,
        origin: record.origin,
        runs: airRuns(sorted),
        runIndex: 0,
        blocks: [],
        index: 0,
        total: sorted.length,
        placed: 0,
        failed: 0,
        deferred: [],
        lastReport: 0,
        cancelled: false,
        startTick: system.currentTick
    }
    player.sendMessage(`${PREFIX} clearing §e${record.entry.name}§r — ${sx}x${sy}x${sz}`)
    return true
}

const AIR = 'minecraft:air'

/**
 * Collapse air into axis-aligned runs. Input is sorted by y, then x, then z, so
 * consecutive air along z is already adjacent in the array.
 */
function airRuns(sorted) {
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
    return runs
}

/**
 * Whether `fillBlocks` is usable. Its signature has drifted across script API
 * versions, so it is probed once rather than assumed, and per-block placement
 * is always available as a fallback.
 */
let fillMode // undefined = untested, 'volume' | 'points' | false
const AIR_PERMUTATION = () => BlockPermutation.resolve(AIR)

function fillAirRun(dimension, from, to) {
    if (fillMode === false) return false
    try {
        if (fillMode === undefined || fillMode === 'points') {
            dimension.fillBlocks(from, to, AIR_PERMUTATION())
            fillMode = 'points'
            return true
        }
    } catch {
        fillMode = false
        return false
    }
    return false
}

// --- the tick loop ---------------------------------------------------------

const permutationCache = new Map()

function permutationFor(block) {
    const key = block.state ? `${block.block}|${JSON.stringify(block.state)}` : block.block
    let permutation = permutationCache.get(key)
    if (permutation === undefined) {
        try {
            permutation = BlockPermutation.resolve(block.block, block.state ?? {})
        } catch {
            // An unknown block or an illegal state combination: fall back to the
            // stateless form rather than aborting the whole building.
            try {
                permutation = BlockPermutation.resolve(block.block)
            } catch {
                permutation = null
            }
        }
        permutationCache.set(key, permutation)
    }
    return permutation
}

system.runInterval(() => {
    if (!active) return

    if (active.cancelled) {
        active.player.sendMessage(`${PREFIX} §ecancelled after ${active.placed.toLocaleString()} blocks.§r`)
        active = null
        return
    }

    const job = active
    let budget = BUDGET.blocksPerTick

    // Clearing pass first: the volume has to be empty before anything is built
    // into it. A filled run costs a fraction of its length against the budget.
    while (budget > 0 && job.runIndex < job.runs.length) {
        const run = job.runs[job.runIndex++]
        const from = { x: job.origin.x + run.x, y: job.origin.y + run.y, z: job.origin.z + run.z0 }
        const to = { x: from.x, y: from.y, z: job.origin.z + run.z1 }

        if (fillAirRun(job.dimension, from, to)) {
            job.placed += run.length
            budget -= 4 // one API call, regardless of run length
            continue
        }

        // Fallback: clear the run block by block. If the budget runs out
        // partway, the run is pushed back with its remainder so the next tick
        // finishes it — dropping it here would leave a hole in the building.
        const permutation = AIR_PERMUTATION()
        let z = from.z
        for (; z <= to.z && budget > 0; z++, budget--) {
            try {
                job.dimension.setBlockPermutation({ x: from.x, y: from.y, z }, permutation)
                job.placed++
            } catch {
                job.failed++
            }
        }
        if (z <= to.z) {
            run.z0 = z - job.origin.z
            run.length = to.z - z + 1
            job.runIndex--
            break
        }
    }
    if (job.runIndex < job.runs.length) return

    while (budget > 0 && job.index < job.blocks.length) {
        const block = job.blocks[job.index++]
        budget--

        const permutation = permutationFor(block)
        if (!permutation) {
            job.failed++
            continue
        }

        const location = {
            x: job.origin.x + block.pos[0],
            y: job.origin.y + block.pos[1],
            z: job.origin.z + block.pos[2]
        }

        try {
            job.dimension.setBlockPermutation(location, permutation)
            job.placed++
        } catch {
            // Almost always an unloaded chunk. Retry once at the end rather
            // than leaving a hole in the building.
            if (job.deferred.length < 20000) job.deferred.push(block)
        }
    }

    // Progress, at most once per 10%.
    const progress = Math.floor((job.placed / job.total) * 10)
    if (progress > job.lastReport && job.index < job.blocks.length) {
        job.lastReport = progress
        job.player.onScreenDisplay?.setActionBar(`${job.entry.name} — ${progress * 10}%`)
    }

    if (job.index < job.blocks.length) return

    // Retry pass for blocks whose chunk was not loaded first time round.
    if (job.deferred.length) {
        job.blocks = job.deferred
        job.deferred = []
        job.index = 0
        job.lastReport = 10
        return
    }

    const seconds = ((system.currentTick - job.startTick) / 20).toFixed(1)
    job.player.sendMessage(
        `${PREFIX} §a${job.entry.name} complete.§r ${job.placed.toLocaleString()} blocks in ${seconds}s` +
            (job.failed ? ` §c(${job.failed} skipped)§r` : '')
    )
    active = null
}, 1)

world.afterEvents.playerLeave.subscribe((event) => {
    if (active && active.player.id === event.playerId) active.cancelled = true
})
