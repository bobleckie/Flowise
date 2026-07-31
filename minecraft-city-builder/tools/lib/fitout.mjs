/**
 * Interior fitout: furniture and fixtures by room type (SPEC.md M6).
 *
 * The premortem's finding was that 108 named fitouts across 68 buildings is not
 * a system — it is hand-authoring with extra steps. So this is ~20 rules keyed
 * to *room type*, parameterised by era and density, rather than one recipe per
 * building. A 1920s office and a 1970s office are the same rule with different
 * materials.
 *
 * Everything is placed only into cells the shell left empty, so furniture never
 * overwrites a stair, a partition, a door or a lift shaft.
 */

/** Vanilla blocks that read as furniture. */
const F = {
    desk: 'minecraft:smooth_stone_slab',
    desk_leg: 'minecraft:stone_bricks',
    chair: 'minecraft:oak_stairs',
    table: 'minecraft:oak_slab',
    table_leg: 'minecraft:oak_fence',
    bed: 'minecraft:bed',
    nightstand: 'minecraft:barrel',
    storage: 'minecraft:chest',
    shelf: 'minecraft:bookshelf',
    rack: 'minecraft:barrel',
    counter: 'minecraft:smooth_quartz_slab',
    counter_base: 'minecraft:quartz_block',
    plant: 'minecraft:flower_pot',
    lamp: 'minecraft:lantern',
    lamp_post: 'minecraft:oak_fence',
    bench: 'minecraft:oak_stairs',
    sofa: 'minecraft:red_wool',
    rug: 'minecraft:red_carpet',
    machine: 'minecraft:blast_furnace',
    sink: 'minecraft:cauldron',
    lectern: 'minecraft:lectern',
    crate: 'minecraft:barrel'
}

/** Bedrock facings. */
const DIR4 = { east: 0, south: 1, west: 2, north: 3 }
const STAIR4 = { east: 0, west: 1, south: 2, north: 3 }

/**
 * Fitout rules, keyed by room type.
 *
 * Each rule receives a room context and places furniture on a grid. `pitch` is
 * the spacing between repeated units, which is what "density" means here.
 */
const RULES = {
    office_open: { pitch: [5, 4], place: deskCluster },
    office_private: { pitch: [6, 5], place: deskCluster },
    classroom: { pitch: [3, 3], place: schoolDesk },
    library_stack: { pitch: [4, 3], place: shelfRun },
    ward: { pitch: [4, 5], place: bedUnit },
    hotel_room: { pitch: [6, 6], place: bedUnit },
    apartment: { pitch: [8, 7], place: dwelling },
    bedroom: { pitch: [7, 6], place: bedUnit, maxUnits: 4 },
    living: { pitch: [8, 7], place: dwelling, maxUnits: 4 },
    penthouse: { pitch: [9, 8], place: dwelling, maxUnits: 6 },
    lobby: { pitch: [7, 7], place: lobbySeating },
    sky_lobby: { pitch: [7, 7], place: lobbySeating },
    restaurant_dining: { pitch: [4, 4], place: diningTable },
    retail_floor: { pitch: [4, 3], place: shelfRun },
    gallery: { pitch: [6, 6], place: lobbySeating },
    workshop: { pitch: [5, 5], place: workBench },
    storage: { pitch: [3, 3], place: crateStack },
    loading_dock: { pitch: [5, 4], place: crateStack },
    transit_mezzanine: { pitch: [6, 5], place: benchRun },
    transit_platform: { pitch: [6, 5], place: benchRun },
    sanctuary: { pitch: [3, 5], place: pewRun },
    auditorium: { pitch: [3, 4], place: pewRun },
    apparatus_bay: { pitch: [6, 6], place: workBench },
    garage_bay: { pitch: [6, 6], place: workBench },
    kitchen: { pitch: [4, 4], place: kitchenRun },
    restaurant_kitchen: { pitch: [4, 4], place: kitchenRun }
}

/** Offsets tried when the grid point itself is occupied. */
const NUDGES = [[0, 0], [1, 0], [0, 1], [2, 0], [0, 2], [1, 1], [2, 2], [3, 1]]

/** Room types that are deliberately left bare. */
const BARE = new Set(['mechanical', 'parking_deck', 'stair', 'elevator_lobby', 'corridor', 'basement', 'cell_block'])

export function hasFitout(band) {
    return Boolean(RULES[band]) && !BARE.has(band)
}

export function fitoutRoomTypes() {
    return Object.keys(RULES)
}

/**
 * Dress one floor.
 *
 * @param put   (x, y, z, block, state?) => void
 * @param free  (x, y, z) => boolean — true when the cell is empty
 */
export function fitoutFloor(put, free, plate, core, band, interiorHeight) {
    const rule = RULES[band]
    if (!rule || BARE.has(band)) return 0

    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    const [px, pz] = rule.pitch
    const y = plate.base + 1
    let placed = 0
    let index = 0

    // Furniture needs standing room; a 2-block floor only fits low items.
    const headroom = interiorHeight

    for (let x = ox + 2; x < ox + sx - 3; x += px) {
        for (let z = oz + 2; z < oz + sz - 3; z += pz) {
            // Keep clear of the core, its doors and the stair landing.
            if (x >= core.x - 1 && x <= core.x + core.w && z >= core.z - 1 && z <= core.z + core.d) continue
            if (rule.maxUnits !== undefined && index >= rule.maxUnits) break

            // The fitout grid and the partition grid can land on the same
            // column, which would silently drop every unit in that row. Nudge
            // to a nearby free spot rather than skipping the room.
            let put_count = 0
            for (const [dx, dz] of NUDGES) {
                const nx = x + dx
                const nz = z + dz
                if (nx >= ox + sx - 2 || nz >= oz + sz - 2) continue
                put_count = rule.place(put, free, nx, y, nz, headroom, index) ?? 0
                if (put_count > 0) break
            }
            if (put_count > 0) index++
            placed += put_count
        }
    }
    return placed
}

// --- individual rules ------------------------------------------------------

/** Only place into cells the shell left empty. */
function set(put, free, x, y, z, block, state) {
    if (!free(x, y, z)) return 0
    put(x, y, z, block, state)
    return 1
}

/**
 * Place a multi-cell item all-or-nothing.
 *
 * A bed is two blocks; half a bed is a broken block in-game, not a short bed.
 * The same is true of any item whose halves reference each other.
 */
function setAll(put, free, cells) {
    for (const [x, y, z] of cells) {
        if (!free(x, y, z)) return 0
    }
    for (const [x, y, z, block, state] of cells) put(x, y, z, block, state)
    return cells.length
}

/** A bed, or nothing. */
function bed(put, free, x, y, z, facing = DIR4.south) {
    const head = facing === DIR4.south ? [x, y, z + 1] : [x, y, z - 1]
    return setAll(put, free, [
        [x, y, z, F.bed, { direction: facing, head_piece_bit: false, occupied_bit: false }],
        [head[0], head[1], head[2], F.bed, { direction: facing, head_piece_bit: true, occupied_bit: false }]
    ])
}

function deskCluster(put, free, x, y, z, headroom) {
    let n = 0
    // Two desks facing each other across a shared spine.
    n += set(put, free, x, y, z, F.desk)
    n += set(put, free, x + 1, y, z, F.desk)
    n += set(put, free, x, y, z + 1, F.chair, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    n += set(put, free, x + 1, y, z - 1, F.chair, { weirdo_direction: STAIR4.south, upside_down_bit: false })
    if (headroom >= 3) n += set(put, free, x, y + 1, z, F.lamp, { hanging: false })
    return n
}

function schoolDesk(put, free, x, y, z) {
    let n = 0
    n += set(put, free, x, y, z, F.desk)
    n += set(put, free, x, y, z + 1, F.chair, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    return n
}

function shelfRun(put, free, x, y, z, headroom) {
    let n = 0
    const height = Math.max(1, Math.min(2, headroom - 1))
    for (let dy = 0; dy < height; dy++) {
        n += set(put, free, x, y + dy, z, F.shelf)
        n += set(put, free, x, y + dy, z + 1, F.shelf)
    }
    return n
}

function bedUnit(put, free, x, y, z) {
    // The bed is the unit. If it will not fit, report failure so the caller
    // nudges elsewhere instead of leaving a nightstand in an empty room.
    const n = bed(put, free, x, y, z)
    if (!n) return 0
    return n + set(put, free, x + 1, y, z, F.nightstand, { facing_direction: 1, open_bit: false })
}

/**
 * A home is a sequence of different rooms, not the same bedroom repeated. The
 * cluster index rotates through sleeping, eating and living so a floor reads as
 * a dwelling rather than a dormitory.
 */
function dwelling(put, free, x, y, z, headroom, index = 0) {
    let n = 0
    switch (index % 3) {
        case 0: // sleeping — the bed is mandatory, see bedUnit
            n += bed(put, free, x, y, z)
            if (!n) return 0
            n += set(put, free, x + 1, y, z, F.nightstand, { facing_direction: 1, open_bit: false })
            n += set(put, free, x + 2, y, z + 1, F.storage, { 'minecraft:cardinal_direction': 'south' })
            break
        case 1: // eating
            n += set(put, free, x, y, z, F.table_leg)
            n += set(put, free, x, y + 1, z, F.table)
            n += set(put, free, x - 1, y, z, F.chair, { weirdo_direction: STAIR4.east, upside_down_bit: false })
            n += set(put, free, x + 1, y, z, F.chair, { weirdo_direction: STAIR4.west, upside_down_bit: false })
            n += set(put, free, x, y, z + 2, F.counter_base)
            n += set(put, free, x, y + 1, z + 2, F.counter)
            break
        default: // living
            n += set(put, free, x, y, z, F.sofa)
            n += set(put, free, x + 1, y, z, F.sofa)
            n += set(put, free, x, y, z + 2, F.rug)
            n += set(put, free, x + 1, y, z + 2, F.rug)
            n += set(put, free, x + 2, y, z, F.shelf)
            if (headroom >= 3) {
                n += set(put, free, x + 2, y, z + 2, F.lamp_post)
                n += set(put, free, x + 2, y + 1, z + 2, F.lamp, { hanging: false })
            }
            break
    }
    return n
}

function lobbySeating(put, free, x, y, z, headroom) {
    let n = 0
    n += set(put, free, x, y, z, F.sofa)
    n += set(put, free, x + 1, y, z, F.sofa)
    n += set(put, free, x, y, z + 2, F.sofa)
    n += set(put, free, x + 1, y, z + 2, F.sofa)
    n += set(put, free, x + 3, y, z + 1, F.plant)
    if (headroom >= 3) {
        n += set(put, free, x + 3, y, z, F.lamp_post)
        n += set(put, free, x + 3, y + 1, z, F.lamp, { hanging: false })
    }
    return n
}

function diningTable(put, free, x, y, z) {
    let n = 0
    n += set(put, free, x, y, z, F.table_leg)
    n += set(put, free, x, y + 1, z, F.table)
    n += set(put, free, x - 1, y, z, F.chair, { weirdo_direction: STAIR4.east, upside_down_bit: false })
    n += set(put, free, x + 1, y, z, F.chair, { weirdo_direction: STAIR4.west, upside_down_bit: false })
    return n
}

function workBench(put, free, x, y, z) {
    let n = 0
    n += set(put, free, x, y, z, F.machine, { 'minecraft:cardinal_direction': 'south', lit: false })
    n += set(put, free, x + 1, y, z, F.desk)
    n += set(put, free, x + 2, y, z, F.crate, { facing_direction: 1, open_bit: false })
    return n
}

function crateStack(put, free, x, y, z, headroom) {
    let n = 0
    const height = Math.max(1, Math.min(3, headroom - 1))
    for (let dy = 0; dy < height; dy++) n += set(put, free, x, y + dy, z, F.crate, { facing_direction: 1, open_bit: false })
    n += set(put, free, x + 1, y, z, F.crate, { facing_direction: 1, open_bit: false })
    return n
}

function benchRun(put, free, x, y, z) {
    let n = 0
    for (let dx = 0; dx < 3; dx++) {
        n += set(put, free, x + dx, y, z, F.bench, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    }
    return n
}

function pewRun(put, free, x, y, z) {
    let n = 0
    for (let dx = 0; dx < 5; dx++) {
        n += set(put, free, x + dx, y, z, F.bench, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    }
    return n
}

function kitchenRun(put, free, x, y, z) {
    let n = 0
    n += set(put, free, x, y, z, F.counter_base)
    n += set(put, free, x, y + 1, z, F.counter)
    n += set(put, free, x + 1, y, z, F.sink)
    n += set(put, free, x + 2, y, z, F.machine, { 'minecraft:cardinal_direction': 'south', lit: false })
    return n
}
