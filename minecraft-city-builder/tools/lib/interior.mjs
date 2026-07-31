/**
 * Interiors: the things that make a shell into a building you can actually use
 * (SPEC.md M3 vertical core, M6 fitout).
 *
 * A generated shell is not usable. You cannot get in, you cannot get up, and
 * inside it is pitch dark. This adds, in order of how badly it is needed:
 *
 *   1. an entrance you can walk through
 *   2. a stair core that connects every floor
 *   3. an elevator shaft with a landing on each floor (M5 rides in it later)
 *   4. light, so the interior is not a black box
 *   5. corridors and partitions, so a floor reads as rooms rather than a hall
 */

import { fitoutFloor } from './fitout.mjs'

/** Bedrock stair facing: weirdo_direction 0=east, 1=west, 2=south, 3=north. */
export const STAIR_FACING = { east: 0, west: 1, south: 2, north: 3 }

/** Doors: direction 0=east, 1=south, 2=west, 3=north. */
export const DOOR_FACING = { east: 0, south: 1, west: 2, north: 3 }

export const FITTINGS = {
    floor: 'minecraft:smooth_stone',
    partition: 'minecraft:white_concrete',
    corridor_floor: 'minecraft:polished_andesite',
    stair: 'minecraft:stone_brick_stairs',
    stair_block: 'minecraft:stone_bricks',
    door: 'minecraft:oak_door',
    light: 'minecraft:lantern',
    ceiling_light: 'minecraft:glowstone',
    shaft: 'minecraft:polished_deepslate',
    shaft_door: 'minecraft:iron_door',
    air: 'minecraft:air'
}

/**
 * Where the vertical core sits, in building coordinates.
 * Monolithic buildings have no declared core, so one is derived — every
 * building needs a stair somewhere.
 */
export function coreRect(entry, [bx, bz]) {
    const declared = entry.structure?.core?.footprint
    if (declared) {
        const [cx, cz] = declared
        return { x: Math.floor((bx - cx) / 2), z: Math.floor((bz - cz) / 2), w: cx, d: cz, derived: false }
    }
    // A minimal stair core tucked against the back wall.
    const w = Math.min(7, Math.max(5, Math.floor(bx / 4)))
    const d = Math.min(9, Math.max(7, Math.floor(bz / 4)))
    return { x: Math.max(1, Math.floor((bx - w) / 2)), z: Math.max(1, bz - d - 1), w, d, derived: true }
}

/**
 * Add interior fabric to an already-generated shell.
 *
 * @param put   (x, y, z, block, state?) => void from the generator
 * @param plates floor plates from `floorPlates()`
 */
export function buildInterior(entry, put, palette, plates, footprint, free) {
    const [bx, bz] = footprint
    const core = coreRect(entry, footprint)
    const stairs = entry.vertical?.stairs ?? 1
    const lifts = (entry.vertical?.passenger_elevators ?? 0) + (entry.vertical?.service_elevators ?? 0)

    // The core is split lengthwise: stairwell at the front, lift shaft behind.
    const stairW = Math.min(core.w, 5)
    const stairD = Math.min(core.d, 7)
    const shaftD = lifts > 0 ? Math.max(0, core.d - stairD) : 0

    for (const [index, plate] of plates.entries()) {
        const next = plates[index + 1]
        const interiorHeight = plate.height - 1
        const band = programAt(entry, plate.floor)

        // Order matters. Lighting sits at ceiling height, which on a 3-block
        // floor is exactly where a door's upper half goes — so every door is
        // placed last, after anything that could overwrite it.
        hollow(put, plate, core, footprint, interiorHeight)
        floorFinish(put, plate, footprint, band)
        lighting(put, plate, core, footprint, interiorHeight)
        if (band && interiorHeight >= 3) partitions(put, plate, core, footprint, interiorHeight, band)
        stairFlight(put, plate, next, core, stairW, stairD, index)
        if (shaftD > 0) liftShaft(put, plate, core, stairD, shaftD, interiorHeight)
        if (shaftD > 0) liftDoors(put, plate, core, stairD)
        coreDoors(put, plate, core, stairW)

        // Furniture last of all: it only fills cells still empty after every
        // structural pass, so it can never displace a stair or a doorway.
        if (free && band) fitoutFloor(put, free, plate, core, band, interiorHeight)
    }

    entrances(put, plates[0], footprint, entry)
    if (stairs > 1) secondaryStair(put, plates, footprint, core)
}

function programAt(entry, floor) {
    return (entry.program ?? []).find((b) => floor >= b.floors[0] && floor <= b.floors[1])?.use
}

/** Clear the volume inside the skin so the floor is walkable. */
function hollow(put, plate, core, [bx, bz], interiorHeight) {
    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    for (let x = 1; x < sx - 1; x++) {
        for (let z = 1; z < sz - 1; z++) {
            for (let v = 1; v <= interiorHeight; v++) put(ox + x, plate.base + v, oz + z, FITTINGS.air)
        }
    }
}

/** Walkable floor finish over the structural slab. */
function floorFinish(put, plate, [bx, bz], band) {
    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    const surface =
        band === 'lobby' || band === 'retail_floor' ? FITTINGS.corridor_floor
        : band === 'parking_deck' ? 'minecraft:gray_concrete'
        : FITTINGS.floor
    for (let x = 1; x < sx - 1; x++) {
        for (let z = 1; z < sz - 1; z++) put(ox + x, plate.base, oz + z, surface)
    }
}

/**
 * A straight stair run with a landing, reversing direction each floor so the
 * stairwell footprint stays constant all the way up.
 */
function stairFlight(put, plate, next, core, stairW, stairD, index) {
    if (!next) return
    const rise = plate.height
    const up = index % 2 === 0 // alternate north/south each floor

    const x0 = core.x + 1
    const runLength = Math.min(rise, stairD - 2)
    if (runLength < 1) return

    for (let step = 0; step < rise; step++) {
        const along = Math.min(step, runLength - 1)
        const z = up ? core.z + 1 + along : core.z + stairD - 2 - along
        const y = plate.base + 1 + step

        for (let w = 0; w < Math.max(1, stairW - 2); w++) {
            const x = x0 + w
            if (step < runLength) {
                put(x, y, z, FITTINGS.stair, { weirdo_direction: up ? STAIR_FACING.south : STAIR_FACING.north, upside_down_bit: false })
                // Solid fill beneath, so the flight is not floating.
                for (let f = plate.base + 1; f < y; f++) put(x, f, z, FITTINGS.stair_block)
            } else {
                put(x, y, z, FITTINGS.air)
            }
        }
    }

    // Opening in the slab above so the flight actually arrives somewhere.
    for (let w = 0; w < Math.max(1, stairW - 2); w++) {
        for (let d = 0; d < 2; d++) {
            const z = up ? core.z + stairD - 2 - d : core.z + 1 + d
            put(x0 + w, next.base, z, FITTINGS.air)
        }
    }
}

/** Lift shaft: a void with a landing door on every floor. */
function liftShaft(put, plate, core, stairD, shaftD, interiorHeight) {
    const z0 = core.z + stairD
    for (let x = core.x + 1; x < core.x + core.w - 1; x++) {
        for (let z = z0; z < z0 + shaftD - 1; z++) {
            put(x, plate.base, z, FITTINGS.shaft)
            for (let v = 1; v <= interiorHeight; v++) put(x, plate.base + v, z, FITTINGS.air)
        }
    }
}

/** Landing doors, placed after everything that could overwrite them. */
function liftDoors(put, plate, core, stairD) {
    const doorX = core.x + Math.floor(core.w / 2)
    const z = core.z + stairD - 1
    put(doorX, plate.base + 1, z, FITTINGS.shaft_door, { direction: DOOR_FACING.north, upper_block_bit: false, open_bit: false, door_hinge_bit: false })
    put(doorX, plate.base + 2, z, FITTINGS.shaft_door, { direction: DOOR_FACING.north, upper_block_bit: true, open_bit: false, door_hinge_bit: false })
}

/** Enough light that the interior is not a black box. */
function lighting(put, plate, core, [bx, bz], interiorHeight) {
    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    const y = plate.base + interiorHeight
    for (let x = 4; x < sx - 2; x += 7) {
        for (let z = 4; z < sz - 2; z += 7) {
            const wx = ox + x
            const wz = oz + z
            // Keep clear of the core; landing doors live on its wall.
            if (wx >= core.x - 1 && wx <= core.x + core.w && wz >= core.z - 1 && wz <= core.z + core.d) continue
            put(wx, y, wz, FITTINGS.ceiling_light)
        }
    }
}

/**
 * Corridor and partitions. Deliberately light-touch: a spine corridor with
 * cross walls, which is what makes a floor read as rooms instead of a hall.
 * Full furniture is M6.
 */
function partitions(put, plate, core, [bx, bz], interiorHeight, band) {
    if (['lobby', 'auditorium', 'sanctuary', 'gallery', 'parking_deck', 'transit_platform', 'retail_floor', 'apparatus_bay'].includes(band)) {
        return // single-volume programs have no partitions
    }
    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    const corridorZ = core.z + Math.floor(core.d / 2)
    if (corridorZ <= oz + 1 || corridorZ >= oz + sz - 2) return

    const spacing = band === 'hotel_room' ? 6 : band === 'apartment' ? 9 : 12

    for (let x = ox + 2; x < ox + sx - 2; x += spacing) {
        // Skip the core so partitions never seal the stairs off.
        if (x >= core.x - 1 && x <= core.x + core.w + 1) continue
        for (let z = oz + 1; z < oz + sz - 1; z++) {
            if (z >= corridorZ - 1 && z <= corridorZ + 1) continue // leave the corridor open
            for (let v = 1; v <= interiorHeight - 1; v++) put(x, plate.base + v, z, FITTINGS.partition)
        }
        // A doorway off the corridor into each room.
        put(x, plate.base + 1, corridorZ + 2, FITTINGS.air)
        put(x, plate.base + 2, corridorZ + 2, FITTINGS.air)
    }
}

/** Doorways through the core wall, so the stairwell is reachable. */
function coreDoors(put, plate, core, stairW) {
    const x = core.x + Math.floor(stairW / 2)
    const z = core.z
    put(x, plate.base + 1, z, FITTINGS.door, { direction: DOOR_FACING.north, upper_block_bit: false, open_bit: false, door_hinge_bit: false })
    put(x, plate.base + 2, z, FITTINGS.door, { direction: DOOR_FACING.north, upper_block_bit: true, open_bit: false, door_hinge_bit: false })
}

/** A way in off the street. Without this the building is sealed. */
function entrances(put, ground, [bx, bz], entry) {
    const [sx, sz] = ground.size
    const [ox, oz] = ground.origin
    const width = Math.max(2, Math.min(6, Math.floor(sx / 8)))
    const cx = ox + Math.floor(sx / 2)
    const height = Math.min(4, ground.height - 1)

    // Main entrance on the south face, plus a service door on the north.
    for (const [z, facing] of [[oz, DOOR_FACING.north], [oz + sz - 1, DOOR_FACING.south]]) {
        for (let dx = -Math.floor(width / 2); dx <= Math.floor(width / 2); dx++) {
            for (let v = 1; v <= height; v++) put(cx + dx, ground.base + v, z, FITTINGS.air)
        }
        // Hang doors in the middle two cells of the opening.
        for (const dx of [0, -1]) {
            put(cx + dx, ground.base + 1, z, FITTINGS.door, { direction: facing, upper_block_bit: false, open_bit: false, door_hinge_bit: dx === 0 })
            put(cx + dx, ground.base + 2, z, FITTINGS.door, { direction: facing, upper_block_bit: true, open_bit: false, door_hinge_bit: dx === 0 })
        }
    }
}

/** A second, code-required stair at the far end of the plan. */
function secondaryStair(put, plates, [bx, bz], core) {
    for (const [index, plate] of plates.entries()) {
        const next = plates[index + 1]
        if (!next) continue
        const [sx, sz] = plate.size
        const [ox, oz] = plate.origin
        const x0 = ox + 2
        const z0 = oz + 2
        if (x0 + 3 >= core.x && x0 <= core.x + core.w) continue

        for (let step = 0; step < plate.height; step++) {
            const z = z0 + Math.min(step, 3)
            const y = plate.base + 1 + step
            for (let w = 0; w < 2; w++) {
                if (step < 4) {
                    put(x0 + w, y, z, FITTINGS.stair, { weirdo_direction: STAIR_FACING.south, upside_down_bit: false })
                    for (let f = plate.base + 1; f < y; f++) put(x0 + w, f, z, FITTINGS.stair_block)
                }
            }
        }
        for (let w = 0; w < 2; w++) {
            for (let d = 0; d < 2; d++) put(x0 + w, next.base, z0 + 3 - d, FITTINGS.air)
        }
    }
}
