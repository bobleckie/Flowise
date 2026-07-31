/**
 * Street and intersection generator (SPEC.md M9).
 *
 * A city is mostly the ground between its buildings, and a generated city gives
 * itself away on that ground before you ever look up: a flat grey ribbon with
 * nothing on it. This builds the ribbon properly — a cross-section of bands
 * (sidewalk, parkway, roadway, median), lane markings that follow the lane
 * count, kerbs, and the street furniture that makes a street legible: lights on
 * mast arms, signals, hydrants, meters, trees, bins, benches, manholes.
 *
 * Streets run along +Z. The caller rotates. Everything is placed on a datum
 * where the roadway surface is y = 0 and the sidewalk surface is y = 1, so a
 * building placed on the sidewalk starts at y = 2.
 *
 * Like `generate.mjs`, this is Node-import-free so it can run inside Bedrock.
 */

/** Injected, so this module runs unchanged at build time and in game. */
let STREETS = { defaults: {}, types: {} }

export function setStreets(data) {
    STREETS = data
}

export function getStreets() {
    return STREETS
}

export function streetType(name) {
    const type = STREETS.types?.[name]
    if (!type) throw new Error(`unknown street type "${name}"`)
    return { ...STREETS.defaults, ...type }
}

export const STREET_BLOCKS = {
    asphalt: 'cb:asphalt',
    line: 'cb:road_line',
    paving: 'cb:paving',
    curb: 'cb:curb',
    manhole: 'cb:manhole',
    light: 'cb:street_light',
    pole: 'cb:light_pole',
    signal: 'cb:traffic_signal',
    hydrant: 'cb:hydrant',
    bollard: 'cb:bollard',
    meter: 'cb:parking_meter',
    sign: 'cb:street_sign',
    bench: 'cb:bench',
    bin: 'cb:trash_can',
    shelter: 'cb:shelter_glass',
    soil: 'minecraft:grass_block',
    trunk: 'minecraft:oak_log',
    canopy: 'minecraft:oak_leaves',
    base: 'minecraft:gravel'
}

/** Height of a street module: tall enough for a light on its pole. */
export const STREET_HEIGHT = 14

/** The pole is four blocks, then the mast-arm head sits on top. */
const POLE_HEIGHT = 4

/**
 * The cross-section as a per-column description, west to east.
 *
 * @returns [{ kind, x, band, edgeOfRoadway: 'west'|'east'|null, lane }]
 */
export function crossSection(type) {
    const columns = []
    let x = 0
    for (const [index, band] of type.bands.entries()) {
        for (let i = 0; i < band.width; i++) {
            columns.push({
                kind: band.kind,
                band: index,
                x,
                withinBand: i,
                bandWidth: band.width,
                lanes: band.lanes ?? 2,
                parking: band.parking ?? false,
                oneway: band.oneway ?? false,
                unmarked: band.unmarked ?? false,
                surface: band.surface ?? null
            })
            x++
        }
    }
    return columns
}

export function rowWidth(type) {
    return type.bands.reduce((sum, band) => sum + band.width, 0)
}

/**
 * What marking, if any, belongs on a roadway column.
 *
 * Parking lanes are two blocks at each kerb with a white edge line inside them;
 * the travel lanes divide what is left. A two-way street gets a double yellow
 * at its centre, a one-way carriageway gets dashes throughout.
 */
export function markingFor(column) {
    if (column.kind !== 'roadway' || column.unmarked) return null

    const width = column.bandWidth
    const at = column.withinBand
    const parking = column.parking ? 2 : 0

    if (parking && (at === parking - 1 || at === width - parking)) return 'edge'
    if (at < parking || at >= width - parking) return null

    const travel = width - parking * 2
    const centre = parking + Math.floor(travel / 2)

    // One block, not two. The double-yellow *texture* already carries both
    // lines with a gap between them; painting two adjacent blocks yellow gives
    // a two-metre-wide stripe down the middle of the road instead.
    if (!column.oneway && travel >= 2 && at === centre) {
        return column.lanes >= 4 ? 'double' : 'center'
    }
    return laneDash(at, parking, travel, column.lanes)
}

function laneDash(at, parking, travel, lanes) {
    if (lanes <= 2) return null
    const perLane = travel / lanes
    for (let n = 1; n < lanes; n++) {
        if (Math.round(parking + perLane * n) === at) return 'dash'
    }
    return null
}

/**
 * A straight run of street, `length` blocks long, running north-south.
 *
 * @param options.length        run length in blocks
 * @param options.type          street type name
 * @param options.offset        distance already travelled, so furniture spacing
 *                              stays in step across consecutive segments
 * @param options.busStop       place a shelter on the east sidewalk
 */
export function generateStreet(name, { length = 32, offset = 0, busStop = false } = {}) {
    const type = streetType(name)
    const columns = crossSection(type)
    const width = columns.length

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= width || z >= length || y < 0 || y >= STREET_HEIGHT) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const paving = { 'cb:paving': type.paving ?? 'concrete' }
    const roadways = columns.filter((c) => c.kind === 'roadway')
    const kerbs = kerbColumns(columns)

    for (const column of columns) {
        for (let z = 0; z < length; z++) {
            const world = offset + z
            surfaceColumn(put, column, z, world, paving, kerbs)
        }
    }

    furniture(put, { type, columns, kerbs, length, offset, roadways, busStop })

    return module_(`street_${name}`, [width, STREET_HEIGHT, length], cells)
}

/** Which sidewalk columns sit against a roadway, and which way they face. */
function kerbColumns(columns) {
    const kerbs = []
    for (const [i, column] of columns.entries()) {
        if (column.kind === 'roadway') continue
        const west = columns[i - 1]
        const east = columns[i + 1]
        if (east?.kind === 'roadway') kerbs.push({ x: column.x, facing: 'east', column })
        if (west?.kind === 'roadway') kerbs.push({ x: column.x, facing: 'west', column })
    }
    return kerbs
}

function surfaceColumn(put, column, z, world, paving, kerbs) {
    const kerb = kerbs.find((k) => k.x === column.x)

    if (column.kind === 'roadway') {
        // An alley is a concrete slab, not a paved carriageway.
        if (column.surface) {
            put(column.x, 0, z, STREET_BLOCKS.paving, { 'cb:paving': column.surface })
            return
        }
        const marking = markingFor(column)
        // A dash is half a tile of paint, laid every other block so a run of
        // them reads as a broken lane line rather than a solid one.
        const paint = marking === 'dash' ? (world % 4 < 2 ? 'dash' : null) : marking
        put(column.x, 0, z, paint ? STREET_BLOCKS.line : STREET_BLOCKS.asphalt,
            paint ? { 'cb:marking': paint, 'minecraft:cardinal_direction': 'north' } : undefined)
        return
    }

    put(column.x, 0, z, STREET_BLOCKS.base)

    // The kerb is the edge of the roadway, whatever band lies behind it. On a
    // residential street that band is the planted parkway, and treating the
    // kerb as a sidewalk-only feature left those streets with no kerb at all —
    // the asphalt simply became grass.
    if (kerb) {
        put(column.x, 1, z, STREET_BLOCKS.curb, {
            ...paving,
            'minecraft:cardinal_direction': kerb.facing === 'east' ? 'south' : 'north'
        })
        return
    }

    if (column.kind === 'parkway' || column.kind === 'median') {
        put(column.x, 1, z, STREET_BLOCKS.soil)
        return
    }
    put(column.x, 1, z, STREET_BLOCKS.paving, paving)
}

/**
 * Street furniture.
 *
 * An empty pavement is the second tell, after an empty roof. Spacing is keyed
 * to the run's absolute offset so consecutive segments of the same street keep
 * one rhythm instead of restarting at every tile boundary.
 */
function furniture(put, { type, columns, kerbs, length, offset, roadways, busStop }) {
    const sidewalks = columns.filter((c) => c.kind === 'sidewalk')
    const parkways = columns.filter((c) => c.kind === 'parkway' || c.kind === 'median')
    if (!sidewalks.length && !parkways.length) return

    const west = kerbs.find((k) => k.facing === 'east')
    const east = kerbs.find((k) => k.facing === 'west')
    const tone = { 'cb:tone': type.pole_tone ?? 'grey' }

    for (let z = 0; z < length; z++) {
        const world = offset + z

        // Lights alternate sides, so one side is lit every half spacing.
        if (type.lights !== false && world % type.light_spacing === 0) {
            const side = (world / type.light_spacing) % 2 === 0 ? west : east
            if (side) {
                for (let y = 0; y < POLE_HEIGHT; y++) put(side.x, 2 + y, z, STREET_BLOCKS.pole, tone)
                put(side.x, 2 + POLE_HEIGHT, z, STREET_BLOCKS.light, {
                    ...tone,
                    // The mast arm reaches out over the roadway.
                    'minecraft:cardinal_direction': side.facing === 'east' ? 'south' : 'north'
                })
            }
        }

        if (world % type.hydrant_spacing === 4 && west) put(west.x, 2, z, STREET_BLOCKS.hydrant)
        if (world % type.hydrant_spacing === 18 && east) put(east.x, 2, z, STREET_BLOCKS.bin)

        if (type.meters && world % type.meter_spacing === 2) {
            for (const kerb of [west, east]) {
                if (!kerb) continue
                put(kerb.x, 2, z, STREET_BLOCKS.meter, {
                    'minecraft:cardinal_direction': kerb.facing === 'east' ? 'south' : 'north'
                })
            }
        }

        // Trees go in the parkway, set back from the kerb — a canopy planted on
        // the kerb column swallows the light pole standing there.
        if (type.trees && world % type.tree_spacing === 3) {
            for (const column of treeColumns(parkways.length ? parkways : sidewalks, kerbs)) {
                streetTree(put, column.x, z)
            }
        }

        // Manholes sit in the travel lane, not in the parking lane.
        if (world % type.manhole_spacing === 9 && roadways.length) {
            const middle = roadways[Math.floor(roadways.length / 2)]
            put(middle.x, 0, z, STREET_BLOCKS.manhole)
        }
    }

    if (busStop && east) {
        const z = Math.floor(length / 2)
        for (const dz of [-1, 0, 1]) {
            put(east.x - 1, 2, z + dz, STREET_BLOCKS.shelter, { 'minecraft:cardinal_direction': 'west' })
            put(east.x - 1, 3, z + dz, STREET_BLOCKS.shelter, { 'minecraft:cardinal_direction': 'west' })
        }
        put(east.x, 2, z, STREET_BLOCKS.bench, { 'minecraft:cardinal_direction': 'west' })
        put(east.x, 2, z - 2, STREET_BLOCKS.sign, { 'minecraft:cardinal_direction': 'west' })
    }
}

/**
 * One planting column per band.
 *
 * In a parkway the tree stands back from the kerb, clear of the light pole. On
 * a commercial street there is no parkway, and the tree belongs in a pit at the
 * kerb — planting it against the building line instead puts a canopy through
 * every shopfront, stoop and bay window on the block.
 */
function treeColumns(columns, kerbs) {
    const byBand = new Map()
    for (const column of columns) {
        if (kerbs.some((k) => k.x === column.x)) continue
        const kerbside = kerbs.some((k) => Math.abs(k.x - column.x) === 1)
        const best = byBand.get(column.band)
        if (column.kind === 'sidewalk') {
            if (kerbside) byBand.set(column.band, column)
        } else if (!best || column.withinBand > best.withinBand) {
            byBand.set(column.band, column)
        }
    }
    return [...byBand.values()]
}

function streetTree(put, x, z) {
    put(x, 1, z, 'minecraft:dirt')
    for (let y = 2; y <= 5; y++) put(x, y, z, STREET_BLOCKS.trunk)
    for (let dy = 4; dy <= 7; dy++) {
        const radius = dy === 7 ? 1 : dy === 4 ? 1 : 2
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue
                if (dx === 0 && dz === 0 && dy <= 5) continue
                put(x + dx, dy + 1, z + dz, STREET_BLOCKS.canopy)
            }
        }
    }
}

/**
 * A crossing of two streets: roadway across the whole square, crosswalks and
 * stop bars on each approach, signals or a stop sign at each corner.
 */
export function generateIntersection(northSouth, eastWest) {
    const ns = streetType(northSouth)
    const ew = streetType(eastWest)
    const width = rowWidth(ns)
    const length = rowWidth(ew)

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= width || z >= length || y < 0 || y >= STREET_HEIGHT) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const nsColumns = crossSection(ns)
    const ewColumns = crossSection(ew)
    const paving = { 'cb:paving': ns.paving ?? 'concrete' }

    const isRoad = (columns, i) => columns[i]?.kind === 'roadway'

    for (let x = 0; x < width; x++) {
        for (let z = 0; z < length; z++) {
            const roadway = isRoad(nsColumns, x) || isRoad(ewColumns, z)
            if (roadway) {
                put(x, 0, z, STREET_BLOCKS.asphalt)
            } else {
                // The four corners are pavement, and they are where everything
                // that makes a junction legible actually stands.
                put(x, 0, z, STREET_BLOCKS.base)
                put(x, 1, z, STREET_BLOCKS.paving, paving)
            }
        }
    }

    crossings(put, nsColumns, ewColumns, width, length)
    corners(put, ns, ew, nsColumns, ewColumns, width, length)

    return module_(`intersection_${northSouth}_${eastWest}`, [width, STREET_HEIGHT, length], cells)
}

/** Zebra bars across each approach, with a stop bar behind them. */
function crossings(put, nsColumns, ewColumns, width, length) {
    const nsRoad = nsColumns.filter((c) => c.kind === 'roadway')
    const ewRoad = ewColumns.filter((c) => c.kind === 'roadway')
    if (!nsRoad.length || !ewRoad.length) return

    const bar = (x, z, dir) =>
        put(x, 0, z, STREET_BLOCKS.line, { 'cb:marking': 'crossing', 'minecraft:cardinal_direction': dir })
    const stop = (x, z, dir) =>
        put(x, 0, z, STREET_BLOCKS.line, { 'cb:marking': 'stop', 'minecraft:cardinal_direction': dir })

    const zLo = ewRoad[0].x
    const zHi = ewRoad[ewRoad.length - 1].x
    const xLo = nsRoad[0].x
    const xHi = nsRoad[nsRoad.length - 1].x

    // Crossings of the north-south roadway, laid at the top and bottom edges.
    for (const column of nsRoad) {
        for (const [z, dir] of [[zLo, 'north'], [zLo + 1, 'north'], [zHi - 1, 'south'], [zHi, 'south']]) {
            bar(column.x, z, dir)
        }
    }
    for (const column of ewRoad) {
        for (const [x, dir] of [[xLo, 'west'], [xLo + 1, 'west'], [xHi - 1, 'east'], [xHi, 'east']]) {
            bar(x, column.x, dir)
        }
    }

    // Stop bars, one lane back from the crossing on each approach.
    for (const column of nsRoad) {
        stop(column.x, zLo + 2, 'north')
        stop(column.x, zHi - 2, 'south')
    }
    for (const column of ewRoad) {
        stop(xLo + 2, column.x, 'west')
        stop(xHi - 2, column.x, 'east')
    }
}

/** Signals, street-name blades and bollards on the four corners. */
function corners(put, ns, ew, nsColumns, ewColumns, width, length) {
    const nsRoad = nsColumns.filter((c) => c.kind === 'roadway')
    const ewRoad = ewColumns.filter((c) => c.kind === 'roadway')
    if (!nsRoad.length || !ewRoad.length) return

    const xLo = nsRoad[0].x - 1
    const xHi = nsRoad[nsRoad.length - 1].x + 1
    const zLo = ewRoad[0].x - 1
    const zHi = ewRoad[ewRoad.length - 1].x + 1

    const signalled = ns.signals || ew.signals
    const tone = { 'cb:tone': ns.pole_tone ?? 'grey' }

    const cornersAt = [
        [xLo, zLo, 'south', 'east'],
        [xHi, zLo, 'south', 'west'],
        [xLo, zHi, 'north', 'east'],
        [xHi, zHi, 'north', 'west']
    ]

    for (const [x, z, faceZ, faceX] of cornersAt) {
        put(x, 2, z, STREET_BLOCKS.sign, { 'minecraft:cardinal_direction': faceZ })

        if (signalled) {
            // A signal head on each corner, facing the traffic it stops.
            put(x, 2, z, STREET_BLOCKS.signal, { 'minecraft:cardinal_direction': faceZ })
            put(x, 2, z + (faceZ === 'south' ? 1 : -1), STREET_BLOCKS.signal, {
                'minecraft:cardinal_direction': faceX
            })
        } else {
            for (let y = 0; y < 3; y++) put(x, 2 + y, z, STREET_BLOCKS.pole, tone)
        }

        // Bollards protect the corner radius from the turning lane.
        put(x + (faceX === 'east' ? 1 : -1), 2, z, STREET_BLOCKS.bollard, tone)
    }
}

function module_(id, footprint, cells) {
    const blocks = [...cells.values()].sort(
        (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
    )
    return { id, footprint, category: 'street', connections: {}, palette: {}, blocks, block_entities: [], entities: [] }
}
