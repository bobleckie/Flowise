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

/**
 * Asphalt: a dark aggregate with a fine speckle and no visible course, so a
 * road reads as poured rather than as laid blocks.
 */
export function asphalt(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.9 + random() * 0.2
            // Occasional lighter aggregate.
            if (random() > 0.93) tone *= 1.22
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/**
 * Sidewalk: cast concrete panels with a tooled joint and a broom finish. The
 * joint is what stops a pavement reading as a grey slab.
 */
export function pavement(name, base, { panel = 8 } = {}) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.96 + random() * 0.08
            // Broom finish: a fine directional texture.
            if (y % 2 === 0) tone *= 0.985
            if (x % panel === 0 || y % panel === 0) tone *= 0.78 // tooled joint
            if (x % panel === 1 || y % panel === 1) tone *= 1.05 // the lit lip beside it
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Painted steelwork — poles, signal housings, hydrants. Barely varying. */
export function paint(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.98 + random() * 0.04
            const edge = Math.min(x, 15 - x)
            if (edge === 0) tone *= 0.88
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** A traffic signal face: three lenses on a dark housing. */
export function signalFace(name) {
    const tex = new Tex().fill([26, 28, 26, 255])
    const lenses = [[[186, 40, 34], 3], [[214, 168, 44], 8], [[62, 176, 86], 13]]
    for (const [color, cy] of lenses) {
        for (let y = -2; y <= 2; y++) {
            for (let x = -2; x <= 2; x++) {
                if (Math.abs(x) + Math.abs(y) > 3) continue
                const lit = 1 - (Math.abs(x) + Math.abs(y)) * 0.09
                tex.set(8 + x, cy + y, shade(color, lit))
            }
        }
    }
    return tex
}

/** A street-name blade: white lettering suggested on a coloured ground. */
export function signBlade(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const edge = Math.min(x, y, 15 - x, 15 - y)
            if (edge < 1) {
                tex.set(x, y, [235, 235, 230])
                continue
            }
            // Suggest lettering: irregular light marks across the middle band.
            const lettering = y >= 6 && y <= 10 && random() > 0.55
            tex.set(x, y, lettering ? [228, 230, 226] : shade(base, 0.96 + random() * 0.08))
        }
    }
    return tex
}

/** Cast-iron cover: a radial pattern in a raised rim. */
export function ironCover(name, base) {
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const dx = x - 7.5
            const dy = y - 7.5
            const r = Math.hypot(dx, dy)
            let tone = 0.9
            if (r > 7) tone = 0.66 // outside the cover
            else if (r > 6.2) tone = 1.12 // rim
            else {
                const spoke = (Math.atan2(dy, dx) + Math.PI) / (Math.PI / 6)
                tone = spoke % 1 < 0.42 ? 0.78 : 1.0
                if (r < 1.6) tone = 0.7
            }
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/**
 * Road markings, painted onto asphalt.
 *
 * The line runs north-south in texture space; the block's cardinal direction
 * turns the whole model, so one texture serves both axes.
 */
export function roadMarking(name, kind, base = [46, 47, 50]) {
    const random = rng(name)
    const tex = asphalt(name, base)
    const white = [226, 226, 218]
    const yellow = [216, 176, 52]

    const stripe = (from, to, color) => {
        for (let y = 0; y < 16; y++) {
            for (let x = from; x < to; x++) {
                // Worn paint: the edges of a line go first.
                const wear = 0.82 + random() * 0.22
                const edge = x === from || x === to - 1 ? 0.9 : 1
                tex.set(x, y, shade(color, wear * edge))
            }
        }
    }
    const band = (from, to, color) => {
        for (let y = from; y < to; y++) {
            for (let x = 0; x < 16; x++) tex.set(x, y, shade(color, 0.84 + random() * 0.2))
        }
    }

    switch (kind) {
        case 'center':
            stripe(7, 9, yellow)
            break
        case 'double':
            stripe(5, 7, yellow)
            stripe(9, 11, yellow)
            break
        case 'dash':
            // Half a tile of paint, so a run of them reads as a dashed lane line.
            for (let y = 0; y < 8; y++) {
                for (let x = 7; x < 9; x++) tex.set(x, y, shade(white, 0.84 + random() * 0.2))
            }
            break
        case 'edge':
            stripe(1, 3, white)
            break
        case 'stop':
            band(2, 6, white)
            break
        case 'crossing':
            // A full painted tile: crosswalk bars are laid a block at a time.
            band(0, 16, white)
            break
        case 'arrow': {
            stripe(7, 9, white)
            for (let i = 0; i < 5; i++) {
                for (let x = 7 - i; x < 9 + i; x++) tex.set(x, 3 + i, shade(white, 0.9))
            }
            break
        }
        default:
            break
    }
    return tex
}

/**
 * Riveted steel plate: the structural steel of an elevated railway, with rivet
 * lines along the flanges. Flat grey paint is what makes a girder read as a
 * concrete beam instead.
 */
export function rivetedSteel(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let tone = 0.94 + random() * 0.1
            // Flange plates top and bottom, web between.
            if (y < 3 || y > 12) tone *= 1.06
            if (y === 3 || y === 12) tone *= 0.72
            // Rivets, on the flanges only.
            if ((y === 1 || y === 14) && x % 3 === 1) tone *= 1.24
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Lattice bracing: a steel column seen as diagonals rather than a solid post. */
export function lattice(name, base) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const onDiagonal = (x + y) % 8 < 2 || (x - y + 16) % 8 < 2
            const onFlange = x < 3 || x > 12
            let tone = onFlange ? 1.04 : onDiagonal ? 0.98 : 0.62
            tone *= 0.96 + random() * 0.08
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Glazed platform tile: a white field with a coloured band, as in a subway. */
export function stationTile(name, field, band) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const joint = x % 4 === 0 || y % 8 === 0
            const inBand = y >= 10 && y < 14
            const base = inBand ? band : field
            let tone = 0.97 + random() * 0.06
            if (joint) tone *= 0.8
            else if (y % 8 === 1) tone *= 1.05
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}

/** Timber ties on ballast, for the deck a rail sits on. */
export function trackBed(name, tie, ballast) {
    const random = rng(name)
    const tex = new Tex()
    for (let y = 0; y < 16; y++) {
        const onTie = y % 4 < 3
        for (let x = 0; x < 16; x++) {
            const base = onTie ? tie : ballast
            let tone = 0.88 + random() * 0.24
            if (onTie && y % 4 === 0) tone *= 0.78
            tex.set(x, y, shade(base, tone))
        }
    }
    return tex
}
