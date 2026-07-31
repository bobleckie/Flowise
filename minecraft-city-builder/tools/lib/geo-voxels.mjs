/**
 * Rasterize block geometry into sub-voxels, so the preview renderer can draw
 * what a custom block actually looks like.
 *
 * Until now the renderer approximated every block as a cube (or, for custom
 * blocks, a hand-listed set of half-cubes). That meant a 45-degree roof wedge
 * and a stack of cubes rendered identically — the preview could not see the
 * difference between the thing being fixed and the fix.
 *
 * This reads the real `.geo.json`, including per-cube rotation, and reports
 * which cells of an RxRxR grid inside the block are solid. At R=8 a 45-degree
 * slope reads as a clean diagonal.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const MODELS = join(ROOT, 'packs', 'city_builder_rp', 'models', 'blocks')
const BLOCKS = join(ROOT, 'packs', 'city_builder_bp', 'blocks')

/**
 * Model space: x and z run -8..8, y runs 0..16, for a block occupying 0..1 in
 * each axis of block space.
 */
const toModel = (bx, by, bz) => [bx * 16 - 8, by * 16, bz * 16 - 8]

const DEG = Math.PI / 180

/** Rotate a point about a pivot on one axis, by -angle (the inverse). */
function unrotate([x, y, z], pivot, rotation) {
    const [rx, ry, rz] = rotation
    let p = [x - pivot[0], y - pivot[1], z - pivot[2]]

    if (rz) {
        const a = -rz * DEG
        p = [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]
    }
    if (ry) {
        const a = -ry * DEG
        p = [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)]
    }
    if (rx) {
        const a = -rx * DEG
        p = [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)]
    }
    return [p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]]
}

function inCube(point, cube) {
    const p = cube.rotation ? unrotate(point, cube.pivot ?? [0, 0, 0], cube.rotation) : point
    const [ox, oy, oz] = cube.origin
    const [sx, sy, sz] = cube.size
    return p[0] >= ox && p[0] <= ox + sx && p[1] >= oy && p[1] <= oy + sy && p[2] >= oz && p[2] <= oz + sz
}

const cache = new Map()

/**
 * Solid cells of a geometry, as `[x, y, z]` indices into an RxRxR grid.
 * Returns null when the geometry file is missing.
 */
export function voxelizeGeometry(identifier, resolution = 8) {
    const key = `${identifier}@${resolution}`
    if (cache.has(key)) return cache.get(key)

    const file = join(MODELS, `${identifier.replace('geometry.cb_', '')}.geo.json`)
    if (!existsSync(file)) {
        cache.set(key, null)
        return null
    }

    const geo = JSON.parse(readFileSync(file, 'utf8'))['minecraft:geometry'][0]
    const cubes = geo.bones.flatMap((bone) => bone.cubes ?? [])

    const cells = []
    for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
            for (let k = 0; k < resolution; k++) {
                const point = toModel((i + 0.5) / resolution, (j + 0.5) / resolution, (k + 0.5) / resolution)
                if (cubes.some((cube) => inCube(point, cube))) cells.push([i, j, k])
            }
        }
    }

    cache.set(key, cells)
    return cells
}

/** Map every `cb:` block id to the geometry it declares. */
let blockGeometry
export function geometryForBlock(blockId) {
    if (!blockGeometry) {
        blockGeometry = new Map()
        if (existsSync(BLOCKS)) {
            for (const file of readdirSync(BLOCKS)) {
                if (!file.endsWith('.json')) continue
                const block = JSON.parse(readFileSync(join(BLOCKS, file), 'utf8'))['minecraft:block']
                const geo = block?.components?.['minecraft:geometry']
                const identifier = typeof geo === 'string' ? geo : geo?.identifier
                if (identifier) blockGeometry.set(`cb:${file.replace('.json', '')}`, identifier)
            }
        }
    }
    return blockGeometry.get(blockId) ?? null
}

/** Rotate a cell index about the block's vertical axis. */
export function rotateCell([x, y, z], resolution, facing) {
    const max = resolution - 1
    switch (facing) {
        case 'east':
            return [max - z, y, x]
        case 'south':
            return [max - x, y, max - z]
        case 'west':
            return [z, y, max - x]
        default:
            return [x, y, z]
    }
}


/** The raw cubes of a block's geometry, or null when it has none. */
const cubeCache = new Map()
export function cubesForBlock(blockId) {
    if (cubeCache.has(blockId)) return cubeCache.get(blockId)

    const identifier = blockId.startsWith('cb:') ? geometryForBlock(blockId) : null
    let cubes = null
    if (identifier) {
        const file = join(MODELS, `${identifier.replace('geometry.cb_', '')}.geo.json`)
        if (existsSync(file)) {
            const geo = JSON.parse(readFileSync(file, 'utf8'))['minecraft:geometry'][0]
            cubes = geo.bones.flatMap((bone) => bone.cubes ?? [])
        }
    }
    cubeCache.set(blockId, cubes)
    return cubes
}
