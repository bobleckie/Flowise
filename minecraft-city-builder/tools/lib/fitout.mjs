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

/**
 * Furniture blocks.
 *
 * The `cb:` entries are custom blocks with real geometry — a sofa with arms and
 * a back, a desk with pedestals, a chandelier with candles (see
 * tools/gen-blocks.mjs). Vanilla blocks are kept only where vanilla already has
 * the right object, like a bed or a chest.
 */
const F = {
    // custom models
    sofa: 'cb:sofa',
    armchair: 'cb:armchair',
    desk: 'cb:desk',
    table: 'cb:table',
    counter: 'cb:counter',
    bookcase: 'cb:bookcase',
    screen: 'cb:screen',
    planter: 'cb:planter',
    art: 'cb:wall_art',
    sconce: 'cb:sconce',
    chandelier: 'cb:chandelier',
    ceiling_light: 'cb:ceiling_light',
    pendant: 'cb:pendant_light',

    // vanilla, where vanilla is already right
    bed: 'minecraft:bed',
    chair: 'minecraft:oak_stairs',
    nightstand: 'minecraft:barrel',
    storage: 'minecraft:chest',
    shelf: 'minecraft:bookshelf',
    rug: 'minecraft:red_carpet',
    machine: 'minecraft:blast_furnace',
    sink: 'minecraft:cauldron',
    lectern: 'minecraft:lectern',
    crate: 'minecraft:barrel',
    bench: 'minecraft:oak_stairs'
}

/** Upholstery colourways, so a lobby is not forty identical sofas. */
const FABRICS = ['charcoal', 'olive', 'rust', 'cream']

/** Custom blocks take a cardinal direction naming the way they face. */
const dir = (facing) => ({ 'minecraft:cardinal_direction': facing })

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

    placed += wallDressing(put, free, plate, core, band, y, headroom)
    return placed
}

/** Room types that get pictures on the wall. */
const ART_ROOMS = new Set([
    'lobby', 'sky_lobby', 'office_open', 'office_private', 'apartment', 'living',
    'penthouse', 'hotel_room', 'restaurant_dining', 'gallery', 'library_stack', 'ward'
])

/**
 * Dress the inside face of the exterior wall with framed art and sconces.
 *
 * A room with furniture but blank walls still reads as a warehouse. The
 * fixture's cardinal direction names the way it faces, which is into the room.
 */
function wallDressing(put, free, plate, core, band, y, headroom) {
    if (!ART_ROOMS.has(band)) return 0
    const [sx, sz] = plate.size
    const [ox, oz] = plate.origin
    if (sx < 8 || sz < 8) return 0

    let n = 0
    let piece = 0
    const artY = y + Math.min(1, headroom - 2)
    const sconceY = y + Math.min(2, headroom - 1)

    // Walk the four interior wall faces, alternating art and sconces.
    const walls = [
        { fixed: 'z', at: oz + 1, from: ox + 3, to: ox + sx - 4, facing: 'south' },
        { fixed: 'z', at: oz + sz - 2, from: ox + 3, to: ox + sx - 4, facing: 'north' },
        { fixed: 'x', at: ox + 1, from: oz + 3, to: oz + sz - 4, facing: 'east' },
        { fixed: 'x', at: ox + sx - 2, from: oz + 3, to: oz + sz - 4, facing: 'west' }
    ]

    for (const wall of walls) {
        for (let along = wall.from; along <= wall.to; along += 5) {
            const x = wall.fixed === 'z' ? along : wall.at
            const z = wall.fixed === 'z' ? wall.at : along
            if (x >= core.x - 1 && x <= core.x + core.w && z >= core.z - 1 && z <= core.z + core.d) continue

            if (piece % 2 === 0) n += set(put, free, x, artY, z, F.art, { 'cb:art': piece % 5, ...dir(wall.facing) })
            else if (headroom >= 3) n += set(put, free, x, sconceY, z, F.sconce, dir(wall.facing))
            piece++
        }
    }
    return n
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

function deskCluster(put, free, x, y, z, headroom, index = 0) {
    let n = 0
    n += set(put, free, x, y, z, F.desk, dir('north'))
    n += set(put, free, x, y, z + 1, F.chair, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    if (index % 3 === 0) n += set(put, free, x + 1, y, z, F.screen, dir('north'))
    if (index % 4 === 1) n += set(put, free, x + 1, y, z, F.planter)
    if (headroom >= 3) n += set(put, free, x, y + headroom - 1, z, F.ceiling_light)
    return n
}

function schoolDesk(put, free, x, y, z) {
    let n = 0
    n += set(put, free, x, y, z, F.desk)
    n += set(put, free, x, y, z + 1, F.chair, { weirdo_direction: STAIR4.north, upside_down_bit: false })
    return n
}

function shelfRun(put, free, x, y, z, headroom, index = 0) {
    let n = 0
    n += set(put, free, x, y, z, F.bookcase, dir('north'))
    n += set(put, free, x, y, z + 1, F.bookcase, dir('south'))
    if (headroom >= 3 && index % 2 === 0) n += set(put, free, x, y + headroom - 1, z, F.ceiling_light)
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
            n += set(put, free, x, y, z, F.table)
            n += set(put, free, x - 1, y, z, F.chair, { weirdo_direction: STAIR4.east, upside_down_bit: false })
            n += set(put, free, x + 1, y, z, F.chair, { weirdo_direction: STAIR4.west, upside_down_bit: false })
            n += set(put, free, x, y, z + 2, F.counter, dir('south'))
            break
        default: { // living
            const fabric = { 'cb:fabric': FABRICS[(index / 3) % FABRICS.length | 0] }
            n += set(put, free, x, y, z, F.sofa, { ...fabric, ...dir('south') })
            n += set(put, free, x + 1, y, z, F.sofa, { ...fabric, ...dir('south') })
            n += set(put, free, x, y, z + 2, F.rug)
            n += set(put, free, x + 1, y, z + 2, F.rug)
            n += set(put, free, x + 2, y, z + 1, F.screen, dir('west'))
            n += set(put, free, x + 2, y, z, F.bookcase, dir('west'))
            if (headroom >= 3) n += set(put, free, x, y + headroom - 1, z + 1, F.pendant)
            break
        }
    }
    return n
}

function lobbySeating(put, free, x, y, z, headroom, index = 0) {
    const fabric = { 'cb:fabric': FABRICS[index % FABRICS.length] }
    let n = 0
    n += set(put, free, x, y, z, F.sofa, { ...fabric, ...dir('south') })
    n += set(put, free, x + 1, y, z, F.sofa, { ...fabric, ...dir('south') })
    n += set(put, free, x, y, z + 3, F.armchair, { ...fabric, ...dir('north') })
    n += set(put, free, x + 2, y, z + 2, F.table)
    n += set(put, free, x + 3, y, z, F.planter)
    if (headroom >= 4) n += set(put, free, x + 1, y + headroom - 1, z + 2, F.chandelier)
    else if (headroom >= 3) n += set(put, free, x + 1, y + headroom - 1, z + 2, F.pendant)
    return n
}

function diningTable(put, free, x, y, z, headroom) {
    let n = 0
    n += set(put, free, x, y, z, F.table)
    n += set(put, free, x - 1, y, z, F.chair, { weirdo_direction: STAIR4.east, upside_down_bit: false })
    n += set(put, free, x + 1, y, z, F.chair, { weirdo_direction: STAIR4.west, upside_down_bit: false })
    if (headroom >= 3) n += set(put, free, x, y + headroom - 1, z, F.pendant)
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

function kitchenRun(put, free, x, y, z, headroom) {
    let n = 0
    n += set(put, free, x, y, z, F.counter, dir('south'))
    n += set(put, free, x + 1, y, z, F.sink)
    n += set(put, free, x + 2, y, z, F.machine, { 'minecraft:cardinal_direction': 'south', lit: false })
    if (headroom >= 3) n += set(put, free, x + 1, y + headroom - 1, z, F.ceiling_light)
    return n
}
