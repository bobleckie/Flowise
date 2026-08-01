/**
 * District tiles: one city block, streets and all (SPEC.md M11).
 *
 * This is the unit that makes a Realm placement possible. A building on its own
 * is a model; a block of them with the street between, the alley behind and the
 * pavement they stand on is a city.
 *
 * The layout is Chicago's. Eight blocks to the mile, a 660 x 330 ft block, a
 * 66 ft right of way — 20 blocks at one block to the metre — widening to 100 ft
 * on the arterials, and a 16 ft alley running the length of the block behind
 * the lots. Streets are laid on the north and west edges of the tile only, so
 * tiles abut without doubling their width.
 *
 * Node-import-free, so the same code runs in Bedrock.
 */

import { crossSection, generateStreet, generateIntersection, rowWidth, streetType, STREET_BLOCKS } from './street.js'
import { generateElevated, generateSubway, transitLine, TUNNEL_DEPTH } from './transit.js'

/** Lots are laid along the street frontage at Chicago's 25 ft standard. */
export const LOT_WIDTH = 8

/** Where the tile's ground sits: roadway 0, pavement 1, building floor 2. */
export const GRADE = 2

/**
 * A tile description. Sizes are in blocks and include the two street edges, so
 * tiles tessellate by laying them `[width, depth]` apart.
 */
export function tileSize(plan) {
    const west = rowWidth(streetType(plan.west_street))
    const north = rowWidth(streetType(plan.north_street))
    return [west + plan.block_length, north + plan.lot_depth * 2 + plan.alley]
}

/**
 * Where the street surface sits inside the tile.
 *
 * A tile with a subway under it is dug: the whole city moves up by the tunnel
 * depth so the tunnel has somewhere to be, which is the same lever SPEC §4.5
 * uses to fit a supertall under the world ceiling.
 */
export function tileDatum(plan) {
    return plan.transit?.kind === 'subway' ? TUNNEL_DEPTH : 0
}

/**
 * Lay out one district tile.
 *
 * @param plan {
 *   id, north_street, west_street, frontage, block_depth, lot_depth, alley,
 *   buildings: [ids], corner_building
 * }
 * @param buildFor  (id) => module   the building generator, injected so this
 *                  file has no dependency on the catalog
 */
export function generateDistrict(plan, buildFor) {
    const westType = streetType(plan.west_street)
    const northType = streetType(plan.north_street)
    const westWidth = rowWidth(westType)
    const northWidth = rowWidth(northType)

    const [width, depth] = tileSize(plan)
    const datum = tileDatum(plan)
    const height = (plan.height ?? 96) + datum

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= width || z >= depth || y < 0 || y >= height) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const stamp = (module, ox, oy, oz) => {
        for (const block of module.blocks) {
            put(ox + block.pos[0], oy + block.pos[1], oz + block.pos[2], block.block, block.state)
        }
    }

    // --- the two streets on the tile's own edges, and their intersection
    const intersection = generateIntersection(plan.west_street, plan.north_street)
    stamp(intersection, 0, datum, 0)

    const westRun = generateStreet(plan.west_street, {
        length: depth - northWidth,
        offset: northWidth
    })
    stamp(westRun, 0, datum, northWidth)

    const northRun = generateStreet(plan.north_street, {
        length: width - westWidth,
        offset: westWidth,
        busStop: Boolean(plan.bus_stop)
    })
    stampRotated(northRun, put, westWidth, datum, 0)

    // --- transit, if the tile carries a line
    layTransit(plan, put, stamp, { width, depth, westWidth, northWidth, datum })

    // --- the block interior: two rows of lots either side of the alley
    const interiorX = westWidth
    const interiorZ = northWidth
    const interiorW = width - westWidth
    const interiorD = depth - northWidth

    const alleyZ = interiorZ + plan.lot_depth
    pave(put, interiorX, interiorZ, interiorW, interiorD, plan, { alleyZ, alley: plan.alley, datum })

    const placed = placeBuildings(plan, buildFor, put, {
        interiorX, interiorZ, interiorW, alleyZ, datum
    })

    const blocks = [...cells.values()].sort(
        (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
    )
    return {
        id: plan.id,
        footprint: [width, height, depth],
        category: 'district',
        connections: {
            north: [plan.north_street],
            west: [plan.west_street],
            east: ['tile'],
            south: ['tile']
        },
        palette: {},
        blocks,
        block_entities: [],
        entities: [],
        contents: placed
    }
}

/**
 * Stamp a north-south street module across the tile as an east-west one.
 *
 * Turning the module a quarter turn is `(x, z) -> (z, length - 1 - x)`; the
 * blocks that carry a cardinal direction turn with it, or every kerb, light and
 * meter on the cross street ends up facing the wrong way.
 */
function stampRotated(module, put, ox, oy, oz) {
    const [w, , l] = module.footprint
    const turn = { north: 'east', east: 'south', south: 'west', west: 'north' }

    for (const block of module.blocks) {
        const [x, y, z] = block.pos
        let state = block.state
        if (state?.['minecraft:cardinal_direction']) {
            state = { ...state, 'minecraft:cardinal_direction': turn[state['minecraft:cardinal_direction']] }
        }
        put(ox + z, oy + y, oz + (w - 1 - x), block.block, state)
    }
    void l
}

/**
 * Ground the block interior.
 *
 * The land behind the building line is private, and on a residential block it
 * is garden, not pavement. Paving the whole interior turned a Chicago block
 * into a car park with houses on it.
 */
function pave(put, x0, z0, w, d, plan, { alleyZ, alley, datum = 0 }) {
    const paved = plan.ground === 'paved'
    const paving = { 'cb:paving': plan.paving ?? 'concrete' }

    for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
            const worldZ = z0 + z
            const inAlley = worldZ >= alleyZ && worldZ < alleyZ + alley
            // An apron at each frontage: the walk from the pavement to the door.
            const apron = z < 2 || z >= d - 2

            for (let y = 0; y < datum; y++) put(x0 + x, y, worldZ, 'minecraft:stone')
            put(x0 + x, datum, worldZ, STREET_BLOCKS.base)
            if (inAlley || apron || paved) {
                put(x0 + x, datum + 1, worldZ, STREET_BLOCKS.paving, inAlley ? { 'cb:paving': 'concrete' } : paving)
            } else {
                put(x0 + x, datum + 1, worldZ, STREET_BLOCKS.soil)
            }
        }
    }
}

/**
 * Fill the two lot rows with buildings from the plan's list.
 *
 * Buildings are laid along the frontage in order and repeated as needed, which
 * is how a real block reads: a run of related types with a taller one on the
 * corner. A building that will not fit the remaining frontage is skipped rather
 * than truncated.
 */
function placeBuildings(plan, buildFor, put, { interiorX, interiorZ, interiorW, alleyZ, datum = 0 }) {
    const placed = []
    const list = plan.buildings ?? []
    if (!list.length) return placed

    const rows = [
        { z: interiorZ, facing: 'north', order: 0 },
        { z: alleyZ + plan.alley, facing: 'south', order: 1 }
    ]

    for (const row of rows) {
        let x = 0
        let index = row.order
        let guard = 0

        while (x < interiorW && guard++ < 64) {
            const remaining = interiorW - x
            const module = pickBuilding(list, index++, buildFor, remaining, plan.lot_depth)
            if (!module) break

            const [mw, , md] = module.footprint
            const id = module.id

            // The south row faces the far street, so it is turned to face out.
            const z = row.facing === 'north' ? row.z : row.z + plan.lot_depth - md
            stampBuilding(module, put, interiorX + x, GRADE + datum, z, row.facing === 'south')
            placed.push({ id, at: [interiorX + x, GRADE + datum, z], facing: row.facing })
            x += mw
        }
    }
    return placed
}

/**
 * The next building for a frontage: the plan's order, but skipping anything too
 * wide for what is left or too deep for the lot.
 *
 * Taking the list strictly in order left a dead stretch of pavement at the end
 * of every block, because the run stopped at the first building that did not
 * fit rather than reaching past it for one that did.
 */
function pickBuilding(list, index, buildFor, remaining, lotDepth) {
    for (let n = 0; n < list.length; n++) {
        const module = buildFor(list[(index + n) % list.length])
        if (!module) continue
        const [mw, , md] = module.footprint
        if (mw <= remaining && md <= lotDepth) return module
    }
    return null
}

/**
 * Lay the tile's transit line, if it has one.
 *
 * An elevated line is stamped on top of the street it runs over — the structure
 * is the same width as that street's right of way, so the two line up exactly.
 * A subway is stamped at the bottom of the dug volume, with the whole city
 * sitting on top of it.
 */
function layTransit(plan, put, stamp, { width, depth, westWidth, northWidth, datum }) {
    const transit = plan.transit
    if (!transit) return

    const line = transitLine(transit.line)
    const overNorth = transit.over === 'north'
    const street = overNorth ? plan.north_street : plan.west_street
    const length = overNorth ? width - westWidth : depth - northWidth
    const station = Boolean(transit.station)

    if (line.kind === 'subway') {
        const module = generateSubway(street, transit.line, { length, station })
        if (overNorth) stampRotated(module, put, westWidth, 0, 0)
        else stamp(module, 0, 0, northWidth)
        return
    }

    const module = generateElevated(street, transit.line, { length, offset: 0, station })
    if (overNorth) stampRotated(module, put, westWidth, datum, 0)
    else stamp(module, 0, datum, northWidth)
}

/** Place a building, optionally turned to face the opposite street. */
function stampBuilding(module, put, ox, oy, oz, flip) {
    const [w, , d] = module.footprint
    const mirror = { north: 'south', south: 'north', east: 'west', west: 'east' }

    for (const block of module.blocks) {
        const [x, y, z] = block.pos
        let state = block.state
        if (flip && state?.['minecraft:cardinal_direction']) {
            state = { ...state, 'minecraft:cardinal_direction': mirror[state['minecraft:cardinal_direction']] }
        }
        if (flip) put(ox + (w - 1 - x), oy + y, oz + (d - 1 - z), block.block, state)
        else put(ox + x, oy + y, oz + z, block.block, state)
    }
}

export { crossSection }
