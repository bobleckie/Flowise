/**
 * Isometric voxel renderer.
 *
 * This exists so the generator can be checked without a game. SPEC.md §5 says
 * Claude Code cannot see the output — that is true of Minecraft, but not of the
 * block data, which can be drawn directly. A wrong bay rhythm, a missing
 * cornice, a setback on the wrong floor or a building that came out a plain box
 * are all visible here, immediately, without anyone opening a world.
 *
 * It is not a substitute for the owner's judgement in-game. It is a way to stop
 * shipping obvious mistakes to that judgement.
 */

import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib'
import { colorOf, colorOfPlaced, TRANSLUCENT } from './blocks.mjs'
import { cubesForBlock } from './geo-voxels.mjs'
import { blockFaces, fillPolygon, shadeFor, UNIT_CUBE } from './polygon.mjs'

// --- PNG --------------------------------------------------------------------

let CRC_TABLE
function crc32(buffer) {
    if (typeof zlibCrc32 === 'function') return zlibCrc32(buffer) >>> 0
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256)
        for (let i = 0; i < 256; i++) {
            let c = i
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            CRC_TABLE[i] = c >>> 0
        }
    }
    let crc = 0xffffffff
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

export function encodePng(width, height, rgb) {
    const stride = width * 3
    const raw = Buffer.alloc(height * (stride + 1))
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0
        rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
    }
    const chunk = (tag, data) => {
        const body = Buffer.concat([Buffer.from(tag, 'ascii'), data])
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const crc = Buffer.alloc(4)
        crc.writeUInt32BE(crc32(body))
        return Buffer.concat([len, body, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // truecolour
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0))
    ])
}

// --- canvas -----------------------------------------------------------------

export class Canvas {
    constructor(width, height, background = [26, 28, 34]) {
        this.width = width
        this.height = height
        this.data = Buffer.alloc(width * height * 3)
        for (let i = 0; i < width * height; i++) {
            this.data[i * 3] = background[0]
            this.data[i * 3 + 1] = background[1]
            this.data[i * 3 + 2] = background[2]
        }
    }

    set(x, y, [r, g, b], alpha = 1) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
        const i = (y * this.width + x) * 3
        if (alpha >= 1) {
            this.data[i] = r
            this.data[i + 1] = g
            this.data[i + 2] = b
        } else {
            this.data[i] = this.data[i] * (1 - alpha) + r * alpha
            this.data[i + 1] = this.data[i + 1] * (1 - alpha) + g * alpha
            this.data[i + 2] = this.data[i + 2] * (1 - alpha) + b * alpha
        }
    }

    blit(other, atX, atY) {
        for (let y = 0; y < other.height; y++) {
            for (let x = 0; x < other.width; x++) {
                const i = (y * other.width + x) * 3
                this.set(atX + x, atY + y, [other.data[i], other.data[i + 1], other.data[i + 2]])
            }
        }
    }

    toPng() {
        return encodePng(this.width, this.height, this.data)
    }
}

// --- camera ------------------------------------------------------------------

/**
 * A general axonometric camera, not a true isometric one.
 *
 * True isometric looks down the (1,1,1) axis, and the normal of a 45-degree
 * roof plane is exactly perpendicular to that: `n · (1,1,1) == 0`. Every
 * pitched roof in the library was therefore edge-on to the camera and culled
 * as a back face, leaving only the notches between courses. The roofs were
 * right; the view of them could not have been more wrong.
 *
 * Turning the camera off the diagonal — 35 degrees round, 50 degrees down —
 * puts every one of the four slopes of a hip roof at a positive angle to the
 * view, so they all draw, and no principal plane of the model is degenerate.
 */
const AZIMUTH = (35 * Math.PI) / 180
const ELEVATION = (50 * Math.PI) / 180

const CA = Math.cos(AZIMUTH)
const SA = Math.sin(AZIMUTH)
const CE = Math.cos(ELEVATION)
const SE = Math.sin(ELEVATION)

/** The direction the camera sits in. A face is visible when `n · VIEW > 0`. */
export const VIEW = [SA, Math.tan(ELEVATION), CA]

/** Screen offset per unit of world, before scaling. Y grows downward. */
const screenUnits = (x, y, z) => [x * CA - z * SA, (x * SA + z * CA) * SE - y * CE]

// --- renderer ---------------------------------------------------------------

/**
 * Render a module's blocks isometrically.
 *
 * @param blocks [{ pos:[x,y,z], block }]
 * @param options.size      cube size in pixels (auto-fitted when omitted)
 * @param options.maxPixels longest edge of the output image
 */
export function renderIso(blocks, { size, maxPixels = 1200, background, cutaway = false } = {}) {
    // Air carries a colour in the table for palette maths, but drawing it would
    // fill every hollowed interior with black cubes.
    blocks = blocks.filter((b) => b.block !== 'minecraft:air')
    if (!blocks.length) throw new Error('nothing to render')

    let maxX = 0
    let maxY = 0
    let maxZ = 0
    for (const b of blocks) {
        if (b.pos[0] > maxX) maxX = b.pos[0]
        if (b.pos[1] > maxY) maxY = b.pos[1]
        if (b.pos[2] > maxZ) maxZ = b.pos[2]
    }
    if (cutaway) {
        const cx = maxX / 2
        const cz = maxZ / 2
        blocks = blocks.filter((b) => !(b.pos[0] > cx && b.pos[2] > cz))
        if (!blocks.length) throw new Error('cutaway removed everything')
    }

    const dx = maxX + 1
    const dy = maxY + 1
    const dz = maxZ + 1

    // Project the bounding box and let its screen extent size the canvas —
    // the camera is no longer axis-aligned, so the old closed form is gone.
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const cx of [0, dx]) {
        for (const cy of [0, dy]) {
            for (const cz of [0, dz]) {
                const [u, t] = screenUnits(cx, cy, cz)
                if (u < minU) minU = u
                if (u > maxU) maxU = u
                if (t < minV) minV = t
                if (t > maxV) maxV = t
            }
        }
    }

    if (!size) {
        size = Math.max(1, Math.floor(Math.min((maxPixels * 0.98) / (maxU - minU), (maxPixels * 0.98) / (maxV - minV))))
    }

    const pad = Math.max(2, Math.round(size / 2))
    const width = Math.ceil((maxU - minU) * size) + pad * 2
    const height = Math.ceil((maxV - minV) * size) + pad * 2
    const canvas = new Canvas(width, height, background)

    // Painter's algorithm: further along the view direction is nearer the
    // camera, so it is drawn later.
    const depthOf = (p) => p[0] * VIEW[0] + p[1] * VIEW[1] + p[2] * VIEW[2]
    const order = blocks.slice().sort((a, b) => depthOf(a.pos) - depthOf(b.pos))

    // Project a point in continuous block space to the screen.
    const project = (fx, fy, fz) => {
        const [u, t] = screenUnits(fx, fy, fz)
        return [pad + (u - minU) * size, pad + (t - minV) * size]
    }

    for (const block of order) {
        const [x, y, z] = block.pos
        const color = colorOfPlaced(block)
        const alpha = TRANSLUCENT.has(block.block) ? 0.55 : 1

        const cubes = cubesForBlock(block.block) ?? UNIT_CUBE
        const facing = block.state?.['minecraft:cardinal_direction']
        const faces = blockFaces(cubes, [x, y, z], facing, VIEW).sort((a, b) => a.depth - b.depth)

        for (const face of faces) {
            const shade = shadeFor(face.normal)
            fillPolygon(
                canvas,
                face.points.map(([fx, fy, fz]) => project(fx, fy, fz)),
                [color[0] * shade, color[1] * shade, color[2] * shade],
                alpha
            )
        }
    }

    return canvas
}
