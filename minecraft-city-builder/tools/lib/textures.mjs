/**
 * Procedural 16x16 block textures.
 *
 * The custom blocks need real textures, and hand-painting forty of them is the
 * content bottleneck this project keeps running into. These are generated from
 * a handful of parameterised patterns instead — shingles, fabric, wood grain,
 * brushed metal, framed art — so a new material is a line of data.
 *
 * Deterministic: the same name always produces the same texture, so a rebuild
 * never silently changes the look of a pack that is already installed.
 */

import { encodePng } from './render.mjs'

/** Small deterministic PRNG, seeded by name. */
function rng(seed) {
    let state = 0
    for (const ch of String(seed)) state = (state * 31 + ch.charCodeAt(0)) >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 0x100000000
    }
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const shade = (rgb, factor) => rgb.map((c) => clamp(c * factor))
const mix = (a, b, t) => a.map((c, i) => clamp(c * (1 - t) + b[i] * t))

class Tex {
    constructor(size = 16) {
        this.size = size
        this.px = Array.from({ length: size }, () => Array.from({ length: size }, () => [0, 0, 0, 0]))
    }

    set(x, y, rgba) {
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
        this.px[y][x] = rgba.length === 4 ? rgba : [...rgba, 255]
    }

    fill(rgba) {
        for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, rgba)
        return this
    }

    toPng() {
        // encodePng takes RGB; alpha is flattened onto transparent-black, and
        // fully transparent pixels are written as magenta-keyed instead.
        const buf = Buffer.alloc(this.size * this.size * 3)
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const [r, g, b] = this.px[y][x]
                const i = (y * this.size + x) * 3
                buf[i] = r
                buf[i + 1] = g
                buf[i + 2] = b
            }
        }
        return encodePng(this.size, this.size, buf)
    }

    /** RGBA PNG, needed wherever a texture has cut-outs. */
    toPngRGBA() {
        return encodeRgbaPng(this.size, this.size, this.px)
    }
}

// --- RGBA PNG ---------------------------------------------------------------

import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib'

function crc32(buffer) {
    return zlibCrc32(buffer) >>> 0
}

function encodeRgbaPng(width, height, px) {
    const raw = Buffer.alloc(height * (width * 4 + 1))
    for (let y = 0; y < height; y++) {
        const rowStart = y * (width * 4 + 1)
        raw[rowStart] = 0
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = px[y][x]
            const i = rowStart + 1 + x * 4
            raw[i] = r
            raw[i + 1] = g
            raw[i + 2] = b
            raw[i + 3] = a ?? 255
        }
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
    ihdr[8] = 8
    ihdr[9] = 6 // truecolour + alpha
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ])
}

// --- patterns ---------------------------------------------------------------

/**
 * Overlapping scalloped shingle courses — the thing that makes a roof read as
 * a roof rather than as a coloured plane.
 */
export function shingle(name, base, { courses = 5, width = 5, round = true } = {}) {
    const random = rng(name)
    const tex = new Tex()
    const courseHeight = 16 / courses

    // Per-shingle weathering, looked up rather than re-rolled per pixel, so a
    // single shingle is one tone instead of noise.
    const tone = new Map()
    const toneFor = (course, tile) => {
        const key = `${course}:${tile}`
        if (!tone.has(key)) tone.set(key, 0.86 + random() * 0.28)
        return tone.get(key)
    }

    for (let y = 0; y < 16; y++) {
        const course = Math.floor(y / courseHeight)
        const within = y - course * courseHeight
        const offset = (course % 2) * Math.floor(width / 2)

        for (let x = 0; x < 16; x++) {
            const tile = Math.floor((x + offset) / width)
            const alongTile = (x + offset) % width

            let shadeFactor = toneFor(course, tile)

            // The shadow the course above casts on this one. This single dark
            // line is what separates shingles from brickwork.
            if (within < 1) shadeFactor *= 0.45
            else if (within < 2) shadeFactor *= 0.78

            // Butt edge catches the light along the bottom of each course.
            if (within >= courseHeight - 1.2) shadeFactor *= 1.14

            // Rounded ends: corners of each shingle fall into shadow.
            if (round) {
                const fromEdge = Math.min(alongTile, width - 1 - alongTile)
                if (fromEdge === 0 && within >= courseHeight - 1.6) shadeFactor *= 0.72
            }

            // Vertical joint between neighbouring shingles.
            if (alongTile === 0) shadeFactor *= 0.62

            // A gentle top-to-bottom gradient across the exposed face.
            shadeFactor *= 1.06 - (within / courseHeight) * 0.1

            tex.set(x, y, shade(base, shadeFactor))
        }
    }
    return tex
}

/** Long, irregular wooden shakes — fewer courses, more variation than slate. */
export function shake(name, base) {
    return shingle(name, base, { courses: 4, width: 7, round: false })
}

/**
 * Barrel (mission) tile: half-round pantiles running down the slope, in
 * alternating cover and pan courses. Reads completely differently from a flat
 * shingle, which is the point of having it.
 */
export function barrelTile(name, base) {
    const random = rng(name)
    const tex = new Tex()
    const pitch = 4 // one cover tile every four pixels across

    for (let x = 0; x < 16; x++) {
        const across = x % pitch
        // Half-round profile: bright along the crown, dark in the pan.
        const curve = Math.cos(((across / pitch) * 2 - 0.5) * Math.PI)
        let profile = 0.72 + Math.max(0, curve) * 0.5
        if (across === 0) profile *= 0.6 // the shadowed joint between tiles

        for (let y = 0; y < 16; y++) {
            // Courses overlap down the slope, so each has a shadow at its head.
            const course = y % 8
            let tone = profile
            if (course === 0) tone *= 0.55
            else if (course === 1) tone *= 0.82
            else if (course === 7) tone *= 1.1
            tone *= 0.95 + random() * 0.1
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/**
 * A window: painted frame, sill, mullions and glazing, with the glass left
 * translucent so it reads as glass rather than as a blue block.
 */
export function window(name, frameColor, glassColor, { mullions = 1, transom = true } = {}) {
    const random = rng(name)
    const tex = new Tex()

    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const edge = Math.min(x, y, 15 - x, 15 - y)

            // Outer frame, with the head lighter and the sill heavier.
            if (edge < 2) {
                const lit = y < 2 ? 1.12 : y > 13 ? 0.8 : 1
                tex.set(x, y, [...shade(frameColor, lit * (edge === 0 ? 0.78 : 1)), 255])
                continue
            }
            // Mullions and transom divide the opening into lights.
            const onMullion = mullions > 0 && Math.abs(x - 8) < 1
            const onTransom = transom && Math.abs(y - 6) < 1
            if (onMullion || onTransom) {
                tex.set(x, y, [...shade(frameColor, 0.92), 255])
                continue
            }

            // Glazing: a diagonal sheen so it does not read as flat colour.
            const sheen = 1 + Math.max(0, 1 - Math.abs(x - y) / 6) * 0.35
            const grime = 0.96 + random() * 0.08
            tex.set(x, y, [...shade(glassColor, sheen * grime), 190])
        }
    }
    return tex
}

/** Ridge tiles: a run of half-round caps. */
export function ridge(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const along = x % 8
            const curve = 1 - Math.abs(along - 3.5) / 5
            let tone = 0.72 + curve * 0.34
            if (along === 0) tone *= 0.66
            tone *= 0.95 + random() * 0.1
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Upholstery: flat colour with a woven speckle and a seam. */
export function fabric(name, base, { seam = true } = {}) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.93 + random() * 0.14
            if ((x + y) % 4 === 0) tone *= 0.97
            if (seam && (y === 3 || y === 12)) tone *= 0.82
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Wood with a grain running vertically. */
export function wood(name, base) {
    const random = rng(name)
    const tex = new Tex()
    const grains = new Set()
    for (let i = 0; i < 5; i++) grains.add(Math.floor(random() * 16))

    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.94 + random() * 0.1
            if (grains.has(x)) tone *= 0.84
            if (y === 0 || y === 15) tone *= 0.9
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Brushed metal: horizontal streaks. */
export function metal(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        const streak = 0.9 + random() * 0.2
        for (let x = 0; x < 16; x++) {
            tex.set(x, y, shade(base, streak * (0.97 + random() * 0.06)))
        }
    }
    return tex
}

/** A lit panel: bright centre falling off to a dim frame. */
export function glowPanel(name, glow, frame) {
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const edge = Math.min(x, y, 15 - x, 15 - y)
            if (edge < 2) tex.set(x, y, frame)
            else {
                const t = Math.min(1, (edge - 1) / 5)
                tex.set(x, y, mix(frame, glow, t))
            }
        }
    }
    return tex
}

/**
 * Framed wall art. The frame is constant; the canvas varies by variant so a
 * corridor of offices does not show the same picture forty times.
 */
export function framedArt(name, variant, frameColor) {
    const random = rng(`${name}:${variant}`)
    const tex = new Tex()
    const palettes = [
        [[62, 84, 122], [148, 176, 204], [222, 214, 190]],
        [[120, 62, 48], [196, 132, 84], [232, 206, 168]],
        [[54, 78, 62], [120, 152, 106], [214, 220, 190]],
        [[80, 62, 96], [150, 122, 168], [226, 214, 226]],
        [[38, 42, 52], [96, 104, 122], [178, 186, 200]]
    ]
    const palette = palettes[variant % palettes.length]

    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const edge = Math.min(x, y, 15 - x, 15 - y)
            if (edge < 2) {
                tex.set(x, y, shade(frameColor, edge === 0 ? 0.7 : 1))
                continue
            }
            // Canvas: soft horizontal bands, which read as landscape or
            // abstract at block scale without looking like noise.
            const band = Math.floor(((y - 2) / 12) * palette.length)
            const base = palette[Math.min(palette.length - 1, band)]
            const jitter = 0.9 + random() * 0.2
            tex.set(x, y, shade(base, jitter))
        }
    }
    return tex
}

/**
 * Clapboard siding: horizontal boards, each with a shadow line under its butt.
 * Used on dormer cheeks, fascias and porch work — the places where a flat
 * colour would give the whole detail away as a painted cube.
 */
export function clapboard(name, base) {
    const random = rng(name)
    const tex = new Tex()
    const course = 4

    for (let y = 0; y < 16; y++) {
        const within = y % course
        for (let x = 0; x < 16; x++) {
            let tone = 0.97 + random() * 0.06
            if (within === 0) tone *= 0.58 // the shadow the board above casts
            else if (within === 1) tone *= 0.88
            else if (within === course - 1) tone *= 1.08 // lit butt edge
            // Occasional board joint.
            if (x === (Math.floor(y / course) % 2 ? 4 : 11)) tone *= 0.8
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/**
 * Ashlar stone: coursed blocks with recessed mortar joints. For cornices,
 * stoops and the parts of a facade that are meant to read as cut stone.
 */
export function ashlar(name, base, { course = 5, length = 8 } = {}) {
    const random = rng(name)
    const tex = new Tex()

    const tone = new Map()
    const toneFor = (row, col) => {
        const key = `${row}:${col}`
        if (!tone.has(key)) tone.set(key, 0.9 + random() * 0.2)
        return tone.get(key)
    }

    for (let y = 0; y < 16; y++) {
        const row = Math.floor(y / course)
        const offset = (row % 2) * Math.floor(length / 2)
        for (let x = 0; x < 16; x++) {
            const col = Math.floor((x + offset) / length)
            let factor = toneFor(row, col)

            const onBedJoint = y % course === 0
            const onHeadJoint = (x + offset) % length === 0
            if (onBedJoint || onHeadJoint) factor *= 0.62
            else if (y % course === 1) factor *= 1.06 // the lit top of each stone
            factor *= 0.98 + random() * 0.04

            tex.set(x, y, shade(base, factor))
        }
    }
    return tex
}

/** A flat colour with a border — used for screens and panels. */
export function panel(name, face, border) {
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const edge = Math.min(x, y, 15 - x, 15 - y)
            tex.set(x, y, edge < 1 ? border : face)
        }
    }
    return tex
}

export { Tex }
