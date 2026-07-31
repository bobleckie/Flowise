/**
 * The module intermediate format (SPEC.md §4.1) and its conversion to and from
 * the `.mcstructure` model.
 *
 * This format is the contract everything downstream depends on, and it is
 * deliberately platform-neutral — nothing Bedrock-specific belongs here beyond
 * block names, which the palette layer abstracts anyway.
 *
 *   {
 *     "id": "office_typical_7x11",
 *     "footprint": [7, 4, 11],            // [x, y, z]
 *     "category": "interior",
 *     "connections": { "north": ["corridor"], ... },
 *     "palette":     { "wall": "$STYLE_WALL", ... },
 *     "blocks": [
 *       { "pos": [0,0,0], "block": "$STYLE_FLOOR", "state": {} },
 *       { "pos": [0,1,0], "block": "minecraft:oak_stairs",
 *         "state": { "weirdo_direction": 2, "upside_down_bit": false },
 *         "waterlogged": true }
 *     ],
 *     "block_entities": [ { "pos": [2,1,3], "data": <nbt-json compound> } ],
 *     "entities": [ <nbt-json compound> ]
 *   }
 *
 * Positions absent from `blocks` become structure void (index -1) and are left
 * untouched on placement. Explicit `minecraft:air` clears instead.
 */

import { AIR, DEFAULT_BLOCK_VERSION, PaletteBuilder, indexOf, positionOf } from './mcstructure.mjs'
import { nbtToJson, jsonToNbt } from './nbt-json.mjs'
import { resolveBlock, isToken } from './palette.mjs'

export const WATER = 'minecraft:water'

/** SPEC.md §4.2 — fixed module dimensions. Checked only under `enforceDimensions`. */
export const DIMENSION_RULES = {
    interior: { footprints: [[7, 4, 11], [7, 4, 7]], note: 'interiors are 7x11 or 7x7, floor height 4' },
    facade: { width: 5, height: 4, note: 'facade bays are 5 wide, floor height 4' }
}

const DIRECTIONS = ['north', 'south', 'east', 'west']

// --- validation ------------------------------------------------------------

export function validateModule(module, { enforceDimensions = false } = {}) {
    const errors = []
    const at = (i) => `blocks[${i}]`

    if (!module || typeof module !== 'object') return ['module must be an object']
    if (typeof module.id !== 'string' || !module.id) errors.push('missing "id"')
    if (typeof module.category !== 'string' || !module.category) errors.push('missing "category"')

    const size = module.footprint
    if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => Number.isInteger(n) && n > 0)) {
        errors.push('"footprint" must be three positive integers [x, y, z]')
        return errors
    }

    if (module.connections !== undefined) {
        if (typeof module.connections !== 'object') errors.push('"connections" must be an object')
        else {
            for (const key of Object.keys(module.connections)) {
                if (!DIRECTIONS.includes(key)) errors.push(`"connections" has unknown direction "${key}"`)
                else if (!Array.isArray(module.connections[key])) errors.push(`connections.${key} must be an array`)
            }
        }
    }

    const seen = new Map()
    const blocks = module.blocks ?? []
    if (!Array.isArray(blocks)) return [...errors, '"blocks" must be an array']

    blocks.forEach((block, i) => {
        const pos = block?.pos
        if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isInteger)) {
            errors.push(`${at(i)}: "pos" must be three integers`)
            return
        }
        for (const axis of [0, 1, 2]) {
            if (pos[axis] < 0 || pos[axis] >= size[axis]) {
                errors.push(`${at(i)}: pos ${JSON.stringify(pos)} is outside footprint ${JSON.stringify(size)}`)
                return
            }
        }
        const key = pos.join(',')
        if (seen.has(key)) errors.push(`${at(i)}: duplicate position ${JSON.stringify(pos)} (also ${at(seen.get(key))})`)
        else seen.set(key, i)

        if (typeof block.block !== 'string' || !block.block) errors.push(`${at(i)}: missing "block"`)
        if (block.state !== undefined && (typeof block.state !== 'object' || Array.isArray(block.state))) {
            errors.push(`${at(i)}: "state" must be an object`)
        }
        if (block.waterlogged && block.extra) {
            errors.push(`${at(i)}: set either "waterlogged" or "extra", not both`)
        }
    })

    for (const [i, entry] of (module.block_entities ?? []).entries()) {
        const pos = entry?.pos
        if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isInteger)) {
            errors.push(`block_entities[${i}]: "pos" must be three integers`)
            continue
        }
        if (!seen.has(pos.join(','))) {
            errors.push(`block_entities[${i}]: no block at ${JSON.stringify(pos)} to attach to`)
        }
        if (entry.data?.type !== 'compound') {
            errors.push(`block_entities[${i}]: "data" must be an nbt-json compound`)
        }
    }

    // Declared palette roles are a manifest of the module's style surface;
    // a token used but never declared is almost always a typo.
    const declared = new Set(Object.values(module.palette ?? {}).filter(isToken))
    for (const [i, block] of blocks.entries()) {
        if (isToken(block.block) && !declared.has(block.block)) {
            errors.push(`${at(i)}: uses token "${block.block}" which is not declared in "palette"`)
        }
    }

    if (enforceDimensions) errors.push(...checkDimensions(module))
    return errors
}

function checkDimensions(module) {
    const errors = []
    const [x, y, z] = module.footprint
    if (module.category === 'interior') {
        const ok = DIMENSION_RULES.interior.footprints.some(([fx, fy, fz]) => fx === x && fy === y && fz === z)
        if (!ok) errors.push(`footprint ${JSON.stringify(module.footprint)} violates §4.2 — ${DIMENSION_RULES.interior.note}`)
    } else if (module.category === 'facade') {
        if (x !== DIMENSION_RULES.facade.width && z !== DIMENSION_RULES.facade.width) {
            errors.push(`footprint ${JSON.stringify(module.footprint)} violates §4.2 — ${DIMENSION_RULES.facade.note}`)
        }
        if (y !== DIMENSION_RULES.facade.height) {
            errors.push(`footprint height ${y} violates §4.2 — ${DIMENSION_RULES.facade.note}`)
        }
    }
    return errors
}

// --- module -> mcstructure model -------------------------------------------

export function moduleToModel(module, { style, blockVersion = DEFAULT_BLOCK_VERSION, origin = [0, 0, 0] } = {}) {
    const errors = validateModule(module)
    if (errors.length) throw new Error(`module "${module?.id ?? '?'}" is invalid:\n  - ${errors.join('\n  - ')}`)

    const size = module.footprint
    const volume = size[0] * size[1] * size[2]
    const builder = new PaletteBuilder(module.block_version ?? blockVersion)
    const layers = [new Int32Array(volume).fill(-1), new Int32Array(volume).fill(-1)]

    // The game always writes both layers for occupied cells, with air standing
    // in where there is nothing extra. Intern it up front so it lands at a
    // stable palette slot.
    const airIndex = builder.intern(AIR, {})

    for (const block of module.blocks) {
        const resolved = resolveBlock(block.block, block.state ?? {}, style)
        const index = indexOf(size, ...block.pos)
        layers[0][index] = builder.intern(resolved.name, resolved.state, block.version ?? builder.version)

        if (block.extra) {
            const extra = resolveBlock(block.extra.block, block.extra.state ?? {}, style)
            layers[1][index] = builder.intern(extra.name, extra.state, block.extra.version ?? builder.version)
        } else if (block.waterlogged) {
            layers[1][index] = builder.intern(WATER, { liquid_depth: 0 }, builder.version)
        } else {
            layers[1][index] = airIndex
        }
    }

    const blockEntities = new Map()
    for (const entry of module.block_entities ?? []) {
        blockEntities.set(indexOf(size, ...entry.pos), jsonToNbt(entry.data, `block_entities[${entry.pos}]`))
    }

    const entities = (module.entities ?? []).map((entity, i) => jsonToNbt(entity, `entities[${i}]`))

    return {
        formatVersion: module.format_version ?? 1,
        size,
        origin,
        palette: builder.entries,
        layers,
        blockEntities,
        entities
    }
}

// --- mcstructure model -> module -------------------------------------------

export function modelToModule(model, { id = 'captured_module', category = 'interior', connections, palette } = {}) {
    const { size, layers } = model

    // Carry the dominant block version at module level so per-block overrides
    // stay rare; mixed-version captures still round-trip exactly.
    const versionCounts = new Map()
    for (const entry of model.palette) versionCounts.set(entry.version, (versionCounts.get(entry.version) ?? 0) + 1)
    const moduleVersion = [...versionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_BLOCK_VERSION

    const blocks = []
    for (let index = 0; index < layers[0].length; index++) {
        const primary = layers[0][index]
        if (primary < 0) continue // structure void — left untouched on placement

        const entry = model.palette[primary]
        if (!entry) throw new Error(`.mcstructure: layer 0 index ${index} references missing palette entry ${primary}`)

        const block = { pos: positionOf(size, index), block: entry.name }
        if (Object.keys(entry.state).length) block.state = entry.state
        if (entry.version !== moduleVersion) block.version = entry.version

        const secondary = layers[1][index]
        if (secondary >= 0) {
            const extra = model.palette[secondary]
            if (!extra) throw new Error(`.mcstructure: layer 1 index ${index} references missing palette entry ${secondary}`)
            if (extra.name === WATER && (extra.state.liquid_depth ?? 0) === 0) {
                block.waterlogged = true
            } else if (extra.name !== AIR) {
                block.extra = { block: extra.name }
                if (Object.keys(extra.state).length) block.extra.state = extra.state
                if (extra.version !== moduleVersion) block.extra.version = extra.version
            }
        }
        blocks.push(block)
    }

    const block_entities = [...model.blockEntities.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, data]) => ({ pos: positionOf(size, index), data: nbtToJson(data) }))

    return {
        id,
        footprint: [...size],
        category,
        block_version: moduleVersion,
        connections: connections ?? { north: [], south: [], east: [], west: [] },
        palette: palette ?? {},
        blocks,
        block_entities,
        entities: model.entities.map(nbtToJson)
    }
}
