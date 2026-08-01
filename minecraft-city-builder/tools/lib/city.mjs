/**
 * City assembler (SPEC.md M14): a grid of district tiles that tessellates.
 *
 * A tile carries streets on its north and west edges only, so tiles abut
 * without doubling the road — but only if the tile on the other side of a
 * street agrees about how wide that street is. Rather than trust three separate
 * tile descriptions to stay consistent, a city declares its grid once: a street
 * and a block length per column, a street and a lot depth per row, and a tile
 * kind per cell. Every tile plan is then derived from that grid, so a street
 * cannot be 20 blocks wide on one side and 30 on the other.
 *
 * The grid closes with a street on its east and south edges, because a city
 * that ends in a building face rather than a kerb reads as a cut-off model.
 *
 * Node-import-free, so the same code runs in Bedrock.
 */

import { rowWidth, streetType, generateStreet, generateIntersection } from './street.mjs'
import { generateDistrict, tileSize, tileDatum } from './district.mjs'

/** Column and row offsets, and the derived tile plan for every cell. */
export function cityLayout(plan) {
    const columns = plan.columns.map((column) => ({
        ...column,
        street: rowWidth(streetType(column.west_street))
    }))
    const rows = plan.rows.map((row) => ({
        ...row,
        street: rowWidth(streetType(row.north_street))
    }))

    let x = 0
    for (const column of columns) {
        column.x = x
        column.width = column.street + column.block_length
        x += column.width
    }
    // The closing street on the east edge.
    const eastStreet = rowWidth(streetType(plan.east_street ?? columns[0].west_street))
    const width = x + eastStreet

    let z = 0
    for (const row of rows) {
        row.z = z
        row.depth = row.street + row.lot_depth * 2 + row.alley
        z += row.depth
    }
    const southStreet = rowWidth(streetType(plan.south_street ?? rows[0].north_street))
    const depth = z + southStreet

    return { columns, rows, width, depth, eastStreet, southStreet }
}

/** The tile plan for one cell: the grid's dimensions, the kind's content. */
export function cellPlan(plan, layout, rowIndex, columnIndex) {
    const column = layout.columns[columnIndex]
    const row = layout.rows[rowIndex]
    const kind = plan.cells[rowIndex][columnIndex]
    const base = plan.tiles[kind]
    if (!base) throw new Error(`${plan.id}: unknown tile kind "${kind}"`)

    return {
        ...base,
        id: `${plan.id}_r${rowIndex}c${columnIndex}`,
        west_street: column.west_street,
        north_street: row.north_street,
        block_length: column.block_length,
        lot_depth: row.lot_depth,
        alley: row.alley,
        // A line runs the length of the avenue, so each tile continues the
        // structure's rhythm rather than restarting its column spacing.
        transit: transitFor(plan, base, layout, rowIndex, columnIndex)
    }
}

/**
 * Which line, if any, crosses this cell.
 *
 * Lines are declared once per avenue or cross street, not per tile — an L that
 * stops at a tile boundary is a bridge to nowhere.
 */
function transitFor(plan, base, layout, rowIndex, columnIndex) {
    for (const line of plan.transit ?? []) {
        if (line.along === 'column' && line.at === columnIndex) {
            return {
                ...line,
                over: 'west',
                offset: layout.rows[rowIndex].z,
                station: (line.stations ?? []).includes(rowIndex)
            }
        }
        if (line.along === 'row' && line.at === rowIndex) {
            return {
                ...line,
                over: 'north',
                offset: layout.columns[columnIndex].x,
                station: (line.stations ?? []).includes(columnIndex)
            }
        }
    }
    return base.transit
}

/**
 * Build the whole city.
 *
 * @param plan      the city description
 * @param buildFor  (id) => module, the building generator
 * @param onTile    optional progress callback, so a long build can report
 */
export function generateCity(plan, buildFor, onTile) {
    const layout = cityLayout(plan)
    const datum = plan.transit?.some((line) => transitKindIsSubway(plan, line)) ? tileDatum({ transit: { kind: 'subway' } }) : 0
    const height = (plan.height ?? 160) + datum

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= layout.width || z >= layout.depth || y < 0 || y >= height) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
    }

    const contents = []

    for (let r = 0; r < layout.rows.length; r++) {
        for (let c = 0; c < layout.columns.length; c++) {
            const tilePlan = cellPlan(plan, layout, r, c)
            const tile = generateDistrict(tilePlan, buildFor)
            const ox = layout.columns[c].x
            const oz = layout.rows[r].z
            const lift = datum - tileDatum(tilePlan)

            for (const block of tile.blocks) {
                put(ox + block.pos[0], block.pos[1] + lift, oz + block.pos[2], block.block, block.state)
            }
            for (const placed of tile.contents) {
                contents.push({
                    ...placed,
                    at: [ox + placed.at[0], placed.at[1] + lift, oz + placed.at[2]]
                })
            }
            if (onTile) onTile({ row: r, column: c, id: tilePlan.id, blocks: tile.blocks.length })
        }
    }

    closeGrid(plan, layout, put, datum)

    const blocks = [...cells.values()].sort(
        (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
    )
    return {
        id: plan.id,
        name: plan.name,
        footprint: [layout.width, height, layout.depth],
        category: 'city',
        connections: {},
        palette: {},
        blocks,
        block_entities: [],
        entities: [],
        contents,
        grade: datum
    }
}

function transitKindIsSubway(plan, line) {
    return line.kind === 'subway'
}

/**
 * The east and south edges.
 *
 * Every tile brings its own north and west streets, so the far side of the last
 * column and the last row would otherwise be a row of building backs with no
 * kerb — which is exactly what a cut-off model looks like.
 */
function closeGrid(plan, layout, put, datum) {
    const eastName = plan.east_street ?? layout.columns[0].west_street
    const southName = plan.south_street ?? layout.rows[0].north_street
    const eastX = layout.width - layout.eastStreet
    const southZ = layout.depth - layout.southStreet

    const east = generateStreet(eastName, { length: southZ, offset: 0 })
    for (const block of east.blocks) {
        put(eastX + block.pos[0], block.pos[1] + datum, block.pos[2], block.block, block.state)
    }

    const south = generateStreet(southName, { length: eastX, offset: 0 })
    const turn = { north: 'east', east: 'south', south: 'west', west: 'north' }
    const [w] = south.footprint
    for (const block of south.blocks) {
        const [x, y, z] = block.pos
        let state = block.state
        if (state?.['minecraft:cardinal_direction']) {
            state = { ...state, 'minecraft:cardinal_direction': turn[state['minecraft:cardinal_direction']] }
        }
        put(z, y + datum, southZ + (w - 1 - x), block.block, state)
    }

    // The corner where the two closing streets meet.
    const corner = generateIntersection(eastName, southName)
    for (const block of corner.blocks) {
        put(eastX + block.pos[0], block.pos[1] + datum, southZ + block.pos[2], block.block, block.state)
    }
}

export { tileSize }
