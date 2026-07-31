/**
 * Polygon rasterisation for the isometric preview.
 *
 * The renderer previously drew every block — including custom geometry — as
 * voxel cubes. A diagonal built from cubes always stair-steps, so a 45-degree
 * roof wedge rendered as a staircase no matter how correct the model was. The
 * preview could not draw the one thing it most needed to show.
 *
 * This draws the model's real faces as flat-shaded polygons, so a slope is a
 * slope and an edge is straight.
 */

/** Fill a convex polygon. `points` are [x, y] in screen space. */
export function fillPolygon(canvas, points, color, alpha = 1) {
    let minY = Infinity
    let maxY = -Infinity
    for (const [, y] of points) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }

    const yStart = Math.max(0, Math.floor(minY))
    const yEnd = Math.min(canvas.height - 1, Math.ceil(maxY))

    for (let y = yStart; y <= yEnd; y++) {
        // Sample at the pixel centre, so adjacent faces meet without a seam.
        const scan = y + 0.5
        let left = Infinity
        let right = -Infinity

        for (let i = 0; i < points.length; i++) {
            const [x1, y1] = points[i]
            const [x2, y2] = points[(i + 1) % points.length]
            if (y1 === y2) continue
            if (scan < Math.min(y1, y2) || scan >= Math.max(y1, y2)) continue

            const t = (scan - y1) / (y2 - y1)
            const x = x1 + t * (x2 - x1)
            if (x < left) left = x
            if (x > right) right = x
        }

        if (left > right) continue
        const xStart = Math.max(0, Math.round(left))
        const xEnd = Math.min(canvas.width - 1, Math.round(right))
        for (let x = xStart; x <= xEnd; x++) canvas.set(x, y, color, alpha)
    }
}

// --- geometry -> faces -----------------------------------------------------

const DEG = Math.PI / 180

/** Rotate a model-space point about a pivot, on one axis. */
function rotatePoint([x, y, z], pivot, rotation) {
    if (!rotation) return [x, y, z]
    const [rx, ry, rz] = rotation
    let p = [x - pivot[0], y - pivot[1], z - pivot[2]]

    if (rx) {
        const a = rx * DEG
        p = [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)]
    }
    if (ry) {
        const a = ry * DEG
        p = [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)]
    }
    if (rz) {
        const a = rz * DEG
        p = [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]
    }
    return [p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]]
}

/** The eight corners of a cube, in order, after its own rotation. */
const CORNER_OFFSETS = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
]

/** Faces as corner indices, with their outward normal before rotation. */
const FACES = [
    { idx: [4, 5, 6, 7], normal: [0, 0, 1] }, // +z south
    { idx: [1, 0, 3, 2], normal: [0, 0, -1] }, // -z north
    { idx: [1, 5, 6, 2], normal: [1, 0, 0] }, // +x east
    { idx: [0, 4, 7, 3], normal: [-1, 0, 0] }, // -x west
    { idx: [3, 2, 6, 7], normal: [0, 1, 0] }, // +y up
    { idx: [0, 1, 5, 4], normal: [0, -1, 0] } // -y down
]

/** Rotate a block-space point about the block's vertical centre. */
function faceRotate([x, y, z], facing) {
    switch (facing) {
        case 'east':
            return [1 - z, y, x]
        case 'south':
            return [1 - x, y, 1 - z]
        case 'west':
            return [z, y, 1 - x]
        default:
            return [x, y, z]
    }
}

/**
 * The same rotation as `faceRotate`, without the translation that keeps a
 * position inside the block. Normals must use this: rotating positions one way
 * and normals the other inverts back-face culling, which kept the hidden faces
 * of every turned block and dropped the visible ones — a correct 45-degree
 * slope came out serrated.
 */
function rotateVector([x, y, z], facing) {
    switch (facing) {
        case 'east':
            return [-z, y, x]
        case 'south':
            return [-x, y, -z]
        case 'west':
            return [z, y, -x]
        default:
            return [x, y, z]
    }
}

/**
 * Convert a geometry's cubes into world-space faces for one placed block.
 *
 * @returns [{ points: [[x,y,z] x4], normal: [x,y,z], depth }]
 */
export function blockFaces(cubes, origin, facing, view = [1, 1, 1]) {
    const out = []
    const viewLen = Math.hypot(...view) || 1

    for (const cube of cubes) {
        const [cx, cy, cz] = cube.origin
        const [sx, sy, sz] = cube.size

        const corners = CORNER_OFFSETS.map((offset) => {
            const model = [cx + offset[0] * sx, cy + offset[1] * sy, cz + offset[2] * sz]
            const rotated = rotatePoint(model, cube.pivot ?? [0, 0, 0], cube.rotation)
            // Model space (-8..8, 0..16, -8..8) to block space (0..1).
            let p = [(rotated[0] + 8) / 16, rotated[1] / 16, (rotated[2] + 8) / 16]
            p = faceRotate(p, facing)
            return [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]]
        })

        for (const face of FACES) {
            // Rotate the normal exactly as the geometry was rotated: first by
            // the cube's own rotation, then by the block's facing.
            const n = rotateVector(rotatePoint(face.normal, [0, 0, 0], cube.rotation), facing)

            // Back faces are skipped. The test has to use the *real* camera
            // direction: under a true isometric camera a 45-degree roof plane
            // has a normal exactly perpendicular to the view, so it was being
            // culled — which is why a correct slope kept coming out as a row of
            // notches no matter what the geometry did.
            if ((n[0] * view[0] + n[1] * view[1] + n[2] * view[2]) / viewLen <= 0.001) continue

            const points = face.idx.map((i) => corners[i])
            const depth =
                points.reduce((sum, p) => sum + p[0] * view[0] + p[1] * view[1] + p[2] * view[2], 0) / 4
            out.push({ points, normal: n, depth })
        }
    }
    return out
}

/** A plain unit cube, for blocks with no custom geometry. */
export const UNIT_CUBE = [{ origin: [-8, 0, -8], size: [16, 16, 16] }]

/**
 * Flat shading. A pure top face is brightest, a south face darkest; a 45-degree
 * slope lands between the two, which is what makes it read as a slope.
 *
 * The key light is deliberately off the camera axis, so two roof planes meeting
 * on a hip get visibly different tones instead of merging into one field.
 */
const LIGHT = (() => {
    const v = [-0.42, 0.86, 0.29]
    const len = Math.hypot(...v)
    return v.map((c) => c / len)
})()

export function shadeFor(normal) {
    const len = Math.hypot(...normal) || 1
    const n = normal.map((c) => c / len)
    const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
    return 0.42 + 0.6 * lambert
}
