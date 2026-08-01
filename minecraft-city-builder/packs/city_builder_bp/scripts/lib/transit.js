/**
 * Transit generator (SPEC.md M10): elevated railway, subway, streetcar.
 *
 * Chicago's transit is not a detail on top of the city — the Loop is named
 * after the elevated structure that encircles it, and the shadow that steelwork
 * throws down Wabash is as much a part of the street as the buildings either
 * side. So the L is built as real structure: lattice columns at the kerb lines,
 * plate girders spanning between them, a ballasted deck, and a station you can
 * climb to.
 *
 * Everything runs along +Z on the same datum as `street.mjs` — roadway surface
 * at y = 0, pavement at y = 1 — except the subway, which is dug from that datum
 * downward and therefore reports its own `grade` offset.
 *
 * Node-import-free, so the same code runs in Bedrock.
 */

import { crossSection, rowWidth, streetType, STREET_BLOCKS } from './street.js'

let LINES = { defaults: {}, lines: {} }

export function setTransit(data) {
    LINES = data
}

export function getTransit() {
    return LINES
}

export function transitLine(name) {
    const line = LINES.lines?.[name]
    if (!line) throw new Error(`unknown transit line "${name}"`)
    return { ...LINES.defaults, ...line }
}

export const TRANSIT_BLOCKS = {
    girder: 'cb:girder',
    column: 'cb:lattice_column',
    bed: 'cb:track_bed',
    rail: 'minecraft:rail',
    handrail: 'cb:handrail',
    canopy: 'cb:platform_canopy',
    tile: 'cb:station_tile',
    turnstile: 'cb:turnstile',
    catenary: 'cb:catenary',
    sign: 'cb:transit_sign',
    deck: 'minecraft:polished_deepslate',
    platform: 'cb:paving',
    stair: 'minecraft:iron_block',
    light: 'cb:ceiling_light',
    fill: 'minecraft:stone'
}

/** Rail clearance: the deck soffit clears a lorry, as the real structure does. */
export const DECK_Y = 9

/** How far below the street datum the subway's running rail sits. */
export const TUNNEL_DEPTH = 10

/** Columns are spaced like the real bents, close enough to read as a rhythm. */
const BENT_SPACING = 6

/**
 * An elevated railway over a street.
 *
 * Returns a module on the street datum, `height` tall, of the same width as the
 * street it runs over — so it can be stamped straight onto a street module.
 */
export function generateElevated(streetName, lineName, { length = 40, offset = 0, station = false } = {}) {
    const type = streetType(streetName)
    const line = transitLine(lineName)
    const columns = crossSection(type)
    const width = rowWidth(type)
    const height = station ? 26 : 20

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= width || z >= length || y < 0 || y >= height) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const roadway = columns.filter((c) => c.kind === 'roadway')
    if (!roadway.length) throw new Error(`${streetName} has no roadway to build over`)

    // The structure is about thirty feet wide over a hundred-foot street, not
    // the full right of way: Chicago's L covers the middle of the road and
    // leaves daylight either side. Spanning the whole roadway roofed the street
    // over and made the block below a tunnel.
    const structure = 4 + 3 * (line.tracks ?? 2)
    const roadFrom = roadway[0].x
    const roadTo = roadway[roadway.length - 1].x
    const deckFrom = Math.max(roadFrom, Math.floor((roadFrom + roadTo - structure) / 2) + 1)
    const deckTo = Math.min(roadTo, deckFrom + structure - 1)
    const westCol = deckFrom
    const eastCol = deckTo
    const steel = { 'cb:steel': line.steel ?? 'oxide' }

    for (let z = 0; z < length; z++) {
        const world = offset + z

        // Bents: a pair of columns and the cross girder that ties them.
        if (world % BENT_SPACING === 0) {
            for (const x of [westCol, eastCol]) {
                for (let y = 1; y < DECK_Y - 1; y++) put(x, y, z, TRANSIT_BLOCKS.column, steel)
            }
            for (let x = deckFrom; x <= deckTo; x++) {
                put(x, DECK_Y - 1, z, TRANSIT_BLOCKS.girder, { ...steel, 'minecraft:cardinal_direction': 'east' })
            }
        }

        // Longitudinal girders under the deck edges, running the length of the
        // line. They belong below the deck, where you see them from the street;
        // on top of it they read as two beams laid across the track.
        for (const x of [deckFrom, deckTo]) {
            put(x, DECK_Y - 1, z, TRANSIT_BLOCKS.girder, { ...steel, 'minecraft:cardinal_direction': 'north' })
        }

        // Deck and two tracks.
        for (let x = deckFrom; x <= deckTo; x++) put(x, DECK_Y, z, TRANSIT_BLOCKS.deck)
        for (const x of trackCentres(deckFrom, deckTo, line.tracks ?? 2)) {
            put(x, DECK_Y, z, TRANSIT_BLOCKS.bed)
            put(x, DECK_Y + 1, z, TRANSIT_BLOCKS.rail, { rail_direction: 0 })
        }

        // Handrail along both edges, so the deck reads as walkable structure.
        put(deckFrom, DECK_Y + 1, z, TRANSIT_BLOCKS.handrail, { 'cb:tone': 'black', 'minecraft:cardinal_direction': 'north' })
        put(deckTo, DECK_Y + 1, z, TRANSIT_BLOCKS.handrail, { 'cb:tone': 'black', 'minecraft:cardinal_direction': 'south' })
    }

    if (station) {
        elevatedStation(put, {
            line, lineName, length, deckFrom, deckTo, columns, width
        })
    }

    return module_(`elevated_${lineName}_${streetName}`, [width, height, length], cells, { grade: 0 })
}

/** Where the running rails sit across the deck, evenly spaced. */
function trackCentres(from, to, tracks) {
    const span = to - from
    const centres = []
    for (let n = 1; n <= tracks; n++) centres.push(from + Math.round((span * n) / (tracks + 1)))
    return centres
}

/**
 * An island platform between the tracks, its canopy, and the stair down to the
 * pavement. A station you cannot reach from the street is scenery.
 */
function elevatedStation(put, { line, lineName, length, deckFrom, deckTo, columns, width }) {
    const centre = Math.floor((deckFrom + deckTo) / 2)
    const from = Math.max(2, Math.floor(length / 2) - 8)
    const to = Math.min(length - 3, from + 16)
    const tone = { 'cb:line': line.colour ?? 'red' }

    for (let z = from; z <= to; z++) {
        // Platform surface, one course above the rail head so it is a platform.
        for (const dx of [-1, 0, 1]) {
            put(centre + dx, DECK_Y + 1, z, TRANSIT_BLOCKS.platform, { 'cb:paving': 'concrete' })
        }
        // Canopy on brackets over the platform.
        if (z % 2 === 0) {
            for (const dx of [-1, 0, 1]) {
                put(centre + dx, DECK_Y + 5, z, TRANSIT_BLOCKS.canopy, { 'minecraft:cardinal_direction': 'north' })
            }
        }
        put(centre, DECK_Y + 4, z, TRANSIT_BLOCKS.light)
    }

    // Station name boards at both ends of the platform.
    for (const z of [from, to]) {
        put(centre, DECK_Y + 3, z, TRANSIT_BLOCKS.sign, { ...tone, 'minecraft:cardinal_direction': 'north' })
    }

    // Stair from the pavement up to the platform, on the west footway.
    const footway = columns.find((c) => c.kind === 'sidewalk')
    const stairX = footway ? footway.x : 1
    const stairZ = from - 1
    for (let y = 2; y <= DECK_Y + 1; y++) {
        put(stairX, y, stairZ, TRANSIT_BLOCKS.stair)
        put(stairX + 1, y, stairZ, TRANSIT_BLOCKS.stair)
        put(stairX, y, stairZ + 1, TRANSIT_BLOCKS.stair)
    }
    for (let x = stairX; x <= centre; x++) put(x, DECK_Y + 1, stairZ, TRANSIT_BLOCKS.platform, { 'cb:paving': 'concrete' })

    // Fare gates where the stair meets the platform.
    put(centre - 1, DECK_Y + 2, stairZ, TRANSIT_BLOCKS.turnstile, { 'minecraft:cardinal_direction': 'north' })
    put(centre + 1, DECK_Y + 2, stairZ, TRANSIT_BLOCKS.turnstile, { 'minecraft:cardinal_direction': 'north' })

    void width
    void lineName
}

/**
 * A subway: a bored tunnel below the street, with an island-platform station
 * and a stair up to a pavement kiosk.
 *
 * The module's own y = 0 is the tunnel invert. `grade` reports where the street
 * datum sits inside it, so a district tile can align the two.
 */
export function generateSubway(streetName, lineName, { length = 48, station = false } = {}) {
    const type = streetType(streetName)
    const line = transitLine(lineName)
    const width = rowWidth(type)
    const grade = TUNNEL_DEPTH
    const height = grade + 4

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= width || z >= length || y < 0 || y >= height) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const columns = crossSection(type)
    const roadway = columns.filter((c) => c.kind === 'roadway')
    const bore = station ? Math.min(width - 4, 16) : Math.min(roadway.length, 10)
    const from = Math.floor((width - bore) / 2)
    const to = from + bore - 1
    const ceiling = 6

    for (let z = 0; z < length; z++) {
        for (let x = from - 1; x <= to + 1; x++) {
            for (let y = 0; y <= ceiling + 1; y++) {
                const shell = x === from - 1 || x === to + 1 || y === 0 || y === ceiling + 1
                if (shell) put(x, y, z, TRANSIT_BLOCKS.fill)
                else put(x, y, z, 'minecraft:air')
            }
        }

        // Tiled walls, so the tunnel reads as a station box rather than a cave.
        for (const x of [from - 1, to + 1]) {
            for (let y = 1; y <= 4; y++) put(x, y, z, TRANSIT_BLOCKS.tile, { 'cb:line': line.colour ?? 'red' })
        }

        for (const x of trackCentres(from, to, line.tracks ?? 2)) {
            put(x, 1, z, TRANSIT_BLOCKS.bed)
            put(x, 2, z, TRANSIT_BLOCKS.rail, { rail_direction: 0 })
        }

        if (z % 8 === 4) put(Math.floor((from + to) / 2), ceiling, z, TRANSIT_BLOCKS.light)
    }

    if (station) subwayStation(put, { line, length, from, to, grade, width, columns })

    return module_(`subway_${lineName}_${streetName}`, [width, height, length], cells, { grade })
}

/** Island platform, stair shaft up through the roadway, and a street kiosk. */
function subwayStation(put, { line, length, from, to, grade, width, columns }) {
    const centre = Math.floor((from + to) / 2)
    const platformFrom = Math.max(2, Math.floor(length / 2) - 10)
    const platformTo = Math.min(length - 3, platformFrom + 20)

    for (let z = platformFrom; z <= platformTo; z++) {
        for (const dx of [-2, -1, 0, 1, 2]) {
            put(centre + dx, 1, z, TRANSIT_BLOCKS.platform, { 'cb:paving': 'granite' })
            put(centre + dx, 2, z, 'minecraft:air')
            put(centre + dx, 3, z, 'minecraft:air')
        }
        // Platform edge, marked and railed at the ends.
        if (z === platformFrom || z === platformTo) {
            for (const dx of [-2, 2]) {
                put(centre + dx, 2, z, TRANSIT_BLOCKS.handrail, { 'cb:tone': 'silver', 'minecraft:cardinal_direction': 'north' })
            }
        }
        if (z % 4 === 0) put(centre, 5, z, TRANSIT_BLOCKS.light)
    }

    put(centre, 3, platformFrom + 1, TRANSIT_BLOCKS.sign, {
        'cb:line': line.colour ?? 'red',
        'minecraft:cardinal_direction': 'north'
    })

    // The way out. A cross passage at the platform's north end runs under the
    // roadway to a stair under the footway, and only the stair breaks the
    // pavement — carving the passage at street level instead cut an open
    // trench straight across the carriageway.
    const footway = columns.find((c) => c.kind === 'sidewalk')
    const kioskX = footway ? Math.min(footway.x + 1, width - 2) : 1
    const passZ = platformFrom - 2
    const lo = Math.min(kioskX, centre)
    const hi = Math.max(kioskX, centre)

    for (let x = lo - 1; x <= hi + 1; x++) {
        for (let y = 1; y <= 5; y++) {
            const shell = y === 1 || y === 5 || x === lo - 1 || x === hi + 1
            put(x, y, passZ, shell ? TRANSIT_BLOCKS.fill : 'minecraft:air')
            put(x, y, passZ - 1, shell ? TRANSIT_BLOCKS.fill : 'minecraft:air')
        }
        put(x, 1, passZ, TRANSIT_BLOCKS.platform, { 'cb:paving': 'granite' })
        put(x, 1, passZ - 1, TRANSIT_BLOCKS.platform, { 'cb:paving': 'granite' })
    }
    put(Math.floor((lo + hi) / 2), 5, passZ, TRANSIT_BLOCKS.light)

    // Fare gates where the passage meets the platform.
    for (const dz of [0, -1]) {
        put(centre + (kioskX < centre ? -3 : 3), 2, passZ + dz, TRANSIT_BLOCKS.turnstile, {
            'minecraft:cardinal_direction': kioskX < centre ? 'west' : 'east'
        })
    }

    // Stair shaft up to the pavement, walled in tiling and open at the top.
    for (let y = 2; y <= grade + 1; y++) {
        for (const dz of [0, -1]) {
            put(kioskX, y, passZ + dz, y <= grade ? TRANSIT_BLOCKS.stair : 'minecraft:air')
            put(kioskX - 1, y, passZ + dz, 'minecraft:air')
            put(kioskX + 1, y, passZ + dz, 'minecraft:air')
        }
        for (const x of [kioskX - 2, kioskX + 2]) {
            for (const dz of [0, -1]) put(x, y, passZ + dz, TRANSIT_BLOCKS.tile, { 'cb:line': line.colour ?? 'red' })
        }
    }

    // The kiosk: an opening in the pavement, railed on three sides, with the
    // line's own name board beside it.
    for (const dx of [-1, 0, 1]) {
        for (const dz of [0, -1]) put(kioskX + dx, grade + 1, passZ + dz, 'minecraft:air')
    }
    put(kioskX - 2, grade + 2, passZ, TRANSIT_BLOCKS.handrail, { 'cb:tone': 'silver', 'minecraft:cardinal_direction': 'north' })
    put(kioskX + 2, grade + 2, passZ, TRANSIT_BLOCKS.handrail, { 'cb:tone': 'silver', 'minecraft:cardinal_direction': 'south' })
    put(kioskX, grade + 2, passZ + 1, TRANSIT_BLOCKS.sign, {
        'cb:line': line.colour ?? 'red',
        'minecraft:cardinal_direction': 'south'
    })
}

/**
 * Streetcar track laid in the roadway, with catenary masts at the kerb.
 *
 * Applied over an existing street rather than generated separately: the track
 * is in the carriageway, not beside it.
 */
export function streetcarOverlay(streetName, lineName, { length = 40, offset = 0 } = {}) {
    const type = streetType(streetName)
    const line = transitLine(lineName)
    const columns = crossSection(type)
    const width = rowWidth(type)

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const roadway = columns.filter((c) => c.kind === 'roadway')
    const kerbs = columns.filter(
        (c, i) => c.kind !== 'roadway' && (columns[i - 1]?.kind === 'roadway' || columns[i + 1]?.kind === 'roadway')
    )
    const centres = trackCentres(roadway[0].x, roadway[roadway.length - 1].x, line.tracks ?? 2)

    for (let z = 0; z < length; z++) {
        for (const x of centres) put(x, 0, z, TRANSIT_BLOCKS.rail, { rail_direction: 0 })
        if ((offset + z) % 10 === 0) {
            for (const kerb of kerbs) {
                put(kerb.x, 2, z, TRANSIT_BLOCKS.catenary, {
                    'cb:tone': 'black',
                    'minecraft:cardinal_direction': kerb.x < roadway[0].x ? 'south' : 'north'
                })
            }
        }
    }

    return module_(`streetcar_${lineName}_${streetName}`, [width, 6, length], cells, { grade: 0 })
}

function module_(id, footprint, cells, extra = {}) {
    const blocks = [...cells.values()].sort(
        (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
    )
    return {
        id,
        footprint,
        category: 'transit',
        connections: {},
        palette: {},
        blocks,
        block_entities: [],
        entities: [],
        ...extra
    }
}

export { STREET_BLOCKS }
