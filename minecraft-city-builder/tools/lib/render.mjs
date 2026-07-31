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
import { colorOf, TRANSLUCENT } from './blocks.mjs'

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

// --- cube sprite ------------------------------------------------------------

/**
 * Face mask for one isometric cube at a given size.
 * 1 = top, 2 = right (+x), 3 = left (+z), 0 = transparent.
 */
function cubeSprite(size) {
    const w = size
    const h = Math.max(1, Math.round(size / 2))
    const v = size
    const width = 2 * w
    const height = 2 * h + v
    const mask = new Uint8Array(width * height)

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const u = px - w + 0.5
            const t = py + 0.5
            let face = 0
            if (Math.abs(u) / w + Math.abs(t - h) / h <= 1) {
                face = 1
            } else if (u >= 0) {
                const edge = 2 * h - (h * u) / w
                if (t > edge && t <= edge + v) face = 2
            } else {
                const edge = 2 * h + (h * u) / w
                if (t > edge && t <= edge + v) face = 3
            }
            mask[py * width + px] = face
        }
    }
    return { mask, width, height, w, h, v }
}

const SHADE = { 1: 1.0, 2: 0.76, 3: 0.55 }

// --- renderer ---------------------------------------------------------------

/**
 * Render a module's blocks isometrically.
 *
 * @param blocks [{ pos:[x,y,z], block }]
 * @param options.size      cube size in pixels (auto-fitted when omitted)
 * @param options.maxPixels longest edge of the output image
 */
export function renderIso(blocks, { size, maxPixels = 1200, background } = {}) {
    if (!blocks.length) throw new Error('nothing to render')

    let maxX = 0
    let maxY = 0
    let maxZ = 0
    for (const b of blocks) {
        if (b.pos[0] > maxX) maxX = b.pos[0]
        if (b.pos[1] > maxY) maxY = b.pos[1]
        if (b.pos[2] > maxZ) maxZ = b.pos[2]
    }
    const dx = maxX + 1
    const dy = maxY + 1
    const dz = maxZ + 1

    // Fit the model to maxPixels if no explicit cube size was given.
    if (!size) {
        const wUnits = dx + dz
        const hUnits = (dx + dz) / 2 + dy
        size = Math.max(1, Math.floor(Math.min((maxPixels * 0.98) / wUnits, (maxPixels * 0.98) / hUnits)))
    }

    const sprite = cubeSprite(size)
    const { w, h, v } = sprite

    const width = (dx + dz) * w + 2 * w
    const height = (dx + dz) * h + dy * v + 2 * h + v
    const canvas = new Canvas(width, height, background)

    const originX = dz * w
    const originY = dy * v

    // Painter's algorithm: the camera looks from (+x, +y, +z), so larger
    // x + y + z is nearer and must be drawn later.
    const order = blocks.slice().sort((a, b) => {
        const da = a.pos[0] + a.pos[1] + a.pos[2]
        const db = b.pos[0] + b.pos[1] + b.pos[2]
        return da - db
    })

    for (const block of order) {
        const [x, y, z] = block.pos
        const color = colorOf(block.block)
        const alpha = TRANSLUCENT.has(block.block) ? 0.55 : 1

        const sx = originX + (x - z) * w - w
        const sy = originY + (x + z) * h - y * v

        for (let py = 0; py < sprite.height; py++) {
            const cy = sy + py
            if (cy < 0 || cy >= height) continue
            for (let px = 0; px < sprite.width; px++) {
                const face = sprite.mask[py * sprite.width + px]
                if (!face) continue
                const shade = SHADE[face]
                canvas.set(sx + px, cy, [color[0] * shade, color[1] * shade, color[2] * shade], alpha)
            }
        }
    }

    return canvas
}
