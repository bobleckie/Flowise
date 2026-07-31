/**
 * Rotation and mirroring for modules and block states (SPEC.md M2).
 *
 * Axes follow Minecraft: north = -Z, south = +Z, east = +X, west = -X.
 * One "turn" is 90 degrees clockwise viewed from above, so a direction vector
 * (x, z) becomes (-z, x): north -> east -> south -> west -> north.
 *
 * Block state properties do not each get their own permutation table. Instead
 * `data/block-states/rotation.json` says how each property ENCODES a direction;
 * this module decodes to a semantic name, applies one shared compass rule, and
 * re-encodes. One rotation rule to get right instead of forty.
 *
 * Anything the table does not recognise is left untouched and reported through
 * `unhandled`, so an unknown directional block surfaces as a warning rather
 * than as a silently wrong wall.
 */

/**
 * The rotation table is injected rather than read from disk, so this module runs
 * unchanged in Node and inside Bedrock's script engine. `tools/lib/rotation-table.mjs`
 * loads it for build-time use; the behaviour pack passes its bundled copy.
 */
export let TABLE = {
    properties: {},
    faceSuffixedProperties: { patterns: [] },
    unrotatedProperties: { names: [] },
    suspiciousSubstrings: { values: [] }
}

export function setRotationTable(table) {
    TABLE = table
    UNROTATED = new Set(TABLE.unrotatedProperties.names)
}

// --- compass ---------------------------------------------------------------

const CW = { north: 'east', east: 'south', south: 'west', west: 'north' }
const MIRROR_X = { east: 'west', west: 'east' } // flips the X axis
const MIRROR_Z = { north: 'south', south: 'north' } // flips the Z axis
const BEARING = { north: 0, east: 4, south: 8, west: 12 } // in 22.5-degree steps

/** Compass bearing of a face, or undefined for up/down/top/bottom. */
function bearingOf(face) {
    return BEARING[face]
}

function rotateFace(face, turns) {
    let current = face
    for (let i = 0; i < (turns & 3); i++) current = CW[current] ?? current
    return current
}

function mirrorFace(face, axis) {
    const map = axis === 'x' ? MIRROR_X : MIRROR_Z
    return map[face] ?? face
}

function rotateAxis(axis, turns) {
    if (turns % 2 === 0) return axis
    if (axis === 'x') return 'z'
    if (axis === 'z') return 'x'
    return axis
}

// --- per-semantic transforms ----------------------------------------------

/**
 * Transform a single state value. Returns `{ value, handled }`; `handled` is
 * false when the property is directional but the table cannot express it.
 */
function transformValue(spec, value, turns, mirror) {
    switch (spec.semantic) {
        case 'face': {
            // `identity` means the stored value is already the face name.
            const decode = spec.identity ? String(value) : spec.values?.[String(value)]
            if (decode === undefined) return { value, handled: false }

            // Mirror first, then rotate — must match `rotatePosition`, or a
            // combined transform moves blocks and their facings differently.
            let face = mirror ? mirrorFace(decode, mirror) : decode
            face = rotateFace(face, turns)

            if (spec.identity) return { value: face, handled: true }
            const encoded = Object.entries(spec.values).find(([, name]) => name === face)?.[0]
            if (encoded === undefined) return { value, handled: false }
            return { value: Number(encoded), handled: true }
        }

        case 'axis': {
            const decode = spec.identity ? String(value) : spec.values?.[String(value)]
            if (decode === undefined) return { value, handled: false }
            // Mirroring about X or Z leaves a pillar's axis alone.
            const next = rotateAxis(decode, turns)
            return { value: spec.identity ? next : Number(Object.entries(spec.values).find(([, n]) => n === next)?.[0]), handled: true }
        }

        case 'angle16': {
            if (typeof value !== 'number') return { value, handled: false }
            const zero = bearingOf(spec.zero ?? 'south')
            if (zero === undefined) return { value, handled: false }

            // Work in absolute bearing (clockwise from north) so rotation and
            // reflection are ordinary angle arithmetic.
            let bearing = (zero + value + 16) % 16
            if (mirror === 'x') bearing = (16 - bearing) % 16
            else if (mirror === 'z') bearing = (8 - bearing + 16) % 16
            bearing = (bearing + 4 * (turns & 3)) % 16

            return { value: (bearing - zero + 16) % 16, handled: true }
        }

        case 'mirror_flip':
            // Rotation does not move a hinge; either mirror swaps its side.
            return { value: mirror ? !value : value, handled: true }

        case 'rail': {
            const descriptor = spec.values?.[String(value)]
            if (!descriptor) return { value, handled: false }

            let next
            if (descriptor.kind === 'straight') {
                next = { kind: 'straight', axis: rotateAxis(descriptor.axis, turns) }
            } else if (descriptor.kind === 'ascending') {
                const face = rotateFace(mirror ? mirrorFace(descriptor.face, mirror) : descriptor.face, turns)
                next = { kind: 'ascending', face }
            } else {
                const faces = descriptor.faces.map((face) => rotateFace(mirror ? mirrorFace(face, mirror) : face, turns))
                next = { kind: 'curve', faces }
            }

            const encoded = Object.entries(spec.values).find(([, d]) => sameDescriptor(d, next))?.[0]
            if (encoded === undefined) return { value, handled: false }
            return { value: Number(encoded), handled: true }
        }

        case 'unhandled':
        default:
            return { value, handled: false }
    }
}

function sameDescriptor(a, b) {
    if (a.kind !== b.kind) return false
    if (a.kind === 'straight') return a.axis === b.axis
    if (a.kind === 'ascending') return a.face === b.face
    // Curves are unordered face pairs.
    return [...a.faces].sort().join() === [...b.faces].sort().join()
}

// --- property names --------------------------------------------------------

const SUFFIXES = ['north', 'south', 'east', 'west']

/** `wall_connection_type_north` -> `wall_connection_type_east` under one turn. */
function rotatePropertyName(name, turns, mirror) {
    for (const pattern of TABLE.faceSuffixedProperties.patterns) {
        if (!name.startsWith(pattern)) continue
        const suffix = name.slice(pattern.length)
        if (!SUFFIXES.includes(suffix)) continue
        const face = rotateFace(mirror ? mirrorFace(suffix, mirror) : suffix, turns)
        return { name: `${pattern}${face}`, handled: true }
    }
    return { name, handled: undefined }
}

let UNROTATED = new Set(TABLE.unrotatedProperties.names)

function looksDirectional(name) {
    if (UNROTATED.has(name)) return false
    return TABLE.suspiciousSubstrings.values.some((needle) => name.includes(needle))
}

// --- public API ------------------------------------------------------------

/**
 * Transform one block state.
 * @returns `{ state, unhandled }` where `unhandled` lists property names that
 *          look directional but could not be transformed.
 */
export function rotateState(state = {}, turns = 0, mirror = null) {
    const next = {}
    const unhandled = []

    for (const [name, value] of Object.entries(state)) {
        const renamed = rotatePropertyName(name, turns, mirror)
        if (renamed.handled) {
            next[renamed.name] = value
            continue
        }

        const spec = TABLE.properties[name]
        if (!spec) {
            next[name] = value
            if (looksDirectional(name)) unhandled.push(name)
            continue
        }

        const result = transformValue(spec, value, turns, mirror)
        next[name] = result.value
        if (!result.handled) unhandled.push(name)
    }

    return { state: next, unhandled }
}

/** Footprint after the transform: an odd number of turns swaps X and Z. */
export function rotateFootprint(footprint, turns) {
    return turns % 2 === 0 ? [...footprint] : [footprint[2], footprint[1], footprint[0]]
}

/**
 * Position after the transform, within a box of `footprint`.
 * Mirroring is applied first, in the module's own frame, then rotation — so
 * `{ turns: 1, mirror: 'x' }` means "mirror, then turn".
 */
export function rotatePosition([x, y, z], footprint, turns = 0, mirror = null) {
    let [sx, , sz] = footprint
    let px = x
    let pz = z

    if (mirror === 'x') px = sx - 1 - px
    else if (mirror === 'z') pz = sz - 1 - pz

    for (let i = 0; i < (turns & 3); i++) {
        // (x, z) -> (sz - 1 - z, x)
        const nx = sz - 1 - pz
        const nz = px
        px = nx
        pz = nz
        ;[sx, sz] = [sz, sx]
    }

    return [px, y, pz]
}

/**
 * Rotate and/or mirror a whole module.
 *
 * @param module  a module in the intermediate format
 * @param options `{ turns: 0..3, mirror: null | 'x' | 'z' }`
 * @returns `{ module, unhandled }` — `unhandled` maps property name to the
 *          blocks that carried it, so a warning names the offending block.
 */
export function rotateModule(module, { turns = 0, mirror = null } = {}) {
    if (!Number.isInteger(turns) || turns < 0 || turns > 3) throw new Error(`turns must be 0-3, got ${turns}`)
    if (mirror !== null && mirror !== 'x' && mirror !== 'z') throw new Error(`mirror must be null, 'x' or 'z', got ${mirror}`)

    const footprint = module.footprint
    const unhandled = new Map()
    const noteUnhandled = (names, blockName) => {
        for (const name of names) {
            if (!unhandled.has(name)) unhandled.set(name, new Set())
            unhandled.get(name).add(blockName)
        }
    }

    const blocks = module.blocks.map((block) => {
        const next = { ...block, pos: rotatePosition(block.pos, footprint, turns, mirror) }
        if (block.state) {
            const result = rotateState(block.state, turns, mirror)
            next.state = result.state
            noteUnhandled(result.unhandled, block.block)
        }
        if (block.extra?.state) {
            const result = rotateState(block.extra.state, turns, mirror)
            next.extra = { ...block.extra, state: result.state }
            noteUnhandled(result.unhandled, block.extra.block)
        }
        return next
    })

    const block_entities = (module.block_entities ?? []).map((entry) => ({
        ...entry,
        pos: rotatePosition(entry.pos, footprint, turns, mirror)
    }))

    const suffix = `${mirror ? `m${mirror}` : ''}${turns ? `r${turns * 90}` : ''}`

    return {
        module: {
            ...module,
            id: suffix ? `${module.id}_${suffix}` : module.id,
            footprint: rotateFootprint(footprint, turns),
            connections: rotateConnections(module.connections, turns, mirror),
            blocks,
            block_entities
        },
        unhandled
    }
}

/** A module's declared edge connections move with it. */
export function rotateConnections(connections, turns, mirror) {
    if (!connections) return connections
    const next = {}
    for (const [face, value] of Object.entries(connections)) {
        const moved = rotateFace(mirror ? mirrorFace(face, mirror) : face, turns)
        next[moved] = value
    }
    return next
}

/** Every orientation a module can be placed at: 4 rotations x {none, mirrored}. */
export const ORIENTATIONS = [
    { turns: 0, mirror: null, label: 'r0' },
    { turns: 1, mirror: null, label: 'r90' },
    { turns: 2, mirror: null, label: 'r180' },
    { turns: 3, mirror: null, label: 'r270' },
    { turns: 0, mirror: 'x', label: 'mirror_x' },
    { turns: 0, mirror: 'z', label: 'mirror_z' }
]

/** Properties in the table that still need measuring in-game. */
export function lowConfidenceProperties() {
    return Object.entries(TABLE.properties)
        .filter(([, spec]) => spec.confidence !== 'high')
        .map(([name, spec]) => ({ name, confidence: spec.confidence, note: spec.note, blocks: spec.blocks }))
}
