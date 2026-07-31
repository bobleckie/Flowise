/**
 * `.mcstructure` (Bedrock structure file) parsing and serialization.
 *
 * On-disk shape, as uncompressed little-endian NBT with an unnamed root:
 *
 *   format_version: int
 *   size: list<int>[3]
 *   structure: compound
 *     block_indices: list<list<int>>          two layers; -1 means "leave alone"
 *     entities: list<compound>
 *     palette: compound
 *       default: compound
 *         block_palette: list<compound>       { name, states, version }
 *         block_position_data: compound       { "<index>": { block_entity_data } }
 *   structure_world_origin: list<int>[3]
 *
 * Block index order is x-major, then y, with z varying fastest:
 *   index = (x * sizeY + y) * sizeZ + z
 *
 * Layer 0 holds the block itself. Layer 1 holds the "extra" block, which in
 * practice is water for waterlogged blocks (stairs, slabs, fences, ladders).
 */

import { TAG, nbt, get, readNbt, writeNbt } from './nbt.mjs'
import { stateToNbt, stateFromNbt } from './nbt-json.mjs'

export const AIR = 'minecraft:air'

/**
 * Bedrock block-state version, packed as major<<24 | minor<<16 | patch<<8 | revision.
 * Captured structures carry their own; this is only the fallback for blocks
 * authored from scratch. Keep it in step with the manifest pins (README).
 */
export const DEFAULT_BLOCK_VERSION = blockVersion(1, 21, 20, 0)

export function blockVersion(major, minor, patch, revision = 0) {
    return ((major << 24) | (minor << 16) | (patch << 8) | revision) >>> 0 | 0
}

export function indexOf(size, x, y, z) {
    return (x * size[1] + y) * size[2] + z
}

export function positionOf(size, index) {
    const z = index % size[2]
    const y = Math.floor(index / size[2]) % size[1]
    const x = Math.floor(index / (size[2] * size[1]))
    return [x, y, z]
}

// --- parsing ---------------------------------------------------------------

function intList(node, label) {
    if (!node) throw new Error(`.mcstructure: missing ${label}`)
    return node.value.map((child) => child.value)
}

/** Parse a `.mcstructure` buffer into a plain model. */
export function parseMcStructure(buffer) {
    const { root } = readNbt(buffer)

    const formatVersion = get(root, 'format_version', TAG.Int)?.value ?? 1
    const size = intList(get(root, 'size', TAG.List), 'size')
    if (size.length !== 3) throw new Error(`.mcstructure: size must have 3 entries, got ${size.length}`)

    const originNode = get(root, 'structure_world_origin', TAG.List)
    const origin = originNode ? intList(originNode, 'structure_world_origin') : [0, 0, 0]

    const structure = get(root, 'structure', TAG.Compound)
    if (!structure) throw new Error('.mcstructure: missing "structure" compound')

    const defaultPalette = get(get(structure, 'palette', TAG.Compound), 'default', TAG.Compound)
    if (!defaultPalette) throw new Error('.mcstructure: missing palette.default')

    const palette = (get(defaultPalette, 'block_palette', TAG.List)?.value ?? []).map((entry) => ({
        name: get(entry, 'name', TAG.String)?.value ?? AIR,
        state: stateFromNbt(get(entry, 'states', TAG.Compound)),
        version: get(entry, 'version', TAG.Int)?.value ?? DEFAULT_BLOCK_VERSION
    }))

    const volume = size[0] * size[1] * size[2]
    const rawLayers = get(structure, 'block_indices', TAG.List)?.value ?? []
    const layers = [0, 1].map((i) => {
        const layer = new Int32Array(volume).fill(-1)
        const source = rawLayers[i]
        if (!source) return layer
        if (source.value.length !== volume) {
            throw new Error(`.mcstructure: layer ${i} has ${source.value.length} indices, expected ${volume}`)
        }
        source.value.forEach((child, index) => {
            layer[index] = child.value
        })
        return layer
    })

    const blockEntities = new Map()
    const positionData = get(defaultPalette, 'block_position_data', TAG.Compound)
    if (positionData) {
        for (const [key, entry] of positionData.value) {
            const data = get(entry, 'block_entity_data', TAG.Compound)
            if (data) blockEntities.set(Number(key), data)
        }
    }

    const entities = get(structure, 'entities', TAG.List)?.value ?? []

    return { formatVersion, size, origin, palette, layers, blockEntities, entities }
}

// --- serialization ---------------------------------------------------------

/** Serialize a model back to a `.mcstructure` buffer. */
export function writeMcStructure(model) {
    const { formatVersion = 1, size, origin = [0, 0, 0], palette, layers, blockEntities, entities } = model
    const volume = size[0] * size[1] * size[2]

    for (const [i, layer] of layers.entries()) {
        if (layer.length !== volume) throw new Error(`.mcstructure: layer ${i} has ${layer.length} indices, expected ${volume}`)
    }

    const paletteList = nbt.list(
        TAG.Compound,
        palette.map((entry) =>
            nbt.compound([
                ['name', nbt.string(entry.name)],
                ['states', stateToNbt(entry.state)],
                ['version', nbt.int(entry.version ?? DEFAULT_BLOCK_VERSION)]
            ])
        )
    )

    // Ascending index order — matches what the game writes and keeps output
    // deterministic regardless of insertion order upstream.
    const positionEntries = [...blockEntities.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, data]) => [String(index), nbt.compound([['block_entity_data', data]])])

    const defaultPalette = nbt.compound([
        ['block_palette', paletteList],
        ['block_position_data', nbt.compound(positionEntries)]
    ])

    const blockIndices = nbt.list(
        TAG.List,
        layers.map((layer) => nbt.list(TAG.Int, Array.from(layer, (value) => nbt.int(value))))
    )

    const structure = nbt.compound([
        ['block_indices', blockIndices],
        ['entities', nbt.list(TAG.Compound, entities)],
        ['palette', nbt.compound([['default', defaultPalette]])]
    ])

    const root = nbt.compound([
        ['format_version', nbt.int(formatVersion)],
        ['size', nbt.list(TAG.Int, size.map(nbt.int))],
        ['structure', structure],
        ['structure_world_origin', nbt.list(TAG.Int, origin.map(nbt.int))]
    ])

    return writeNbt(root, '')
}

// --- palette building ------------------------------------------------------

/** Interns (name, state) pairs into a palette, returning stable indices. */
export class PaletteBuilder {
    constructor(version = DEFAULT_BLOCK_VERSION) {
        this.version = version
        this.entries = []
        this.index = new Map()
    }

    intern(name, state = {}, version = this.version) {
        const parts = Object.keys(state)
            .sort()
            .map((key) => `${key}=${JSON.stringify(state[key])}`)
        const key = `${name}|${parts.join(',')}|${version}`
        const existing = this.index.get(key)
        if (existing !== undefined) return existing
        const next = this.entries.length
        this.entries.push({ name, state, version })
        this.index.set(key, next)
        return next
    }
}
