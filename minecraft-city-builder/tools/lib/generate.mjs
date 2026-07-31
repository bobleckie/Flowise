/**
 * Building generator: a catalog entry in, a placeable module out (SPEC.md M3).
 *
 * The premortem's worst finding was that the catalog specifies 357 distinct
 * generators — 51 facade systems, 33 window patterns, 165 features — and that
 * authoring them one at a time is months of work that will not happen.
 *
 * The fix is to stop treating them as generators. A facade system is a *material
 * binding* (data, in data/palettes/materials.json) and a window pattern is a
 * *parameter set* over about eight geometric families. One generator, two data
 * tables. 51 x 33 combinations, ~10 pieces of code.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const MATERIALS = JSON.parse(readFileSync(join(ROOT, 'data', 'palettes', 'materials.json'), 'utf8')).systems

/**
 * Every catalog window pattern, reduced to a geometric family plus parameters.
 *
 *   grid      isolated openings on a bay rhythm
 *   ribbon    continuous horizontal band, interrupted by piers
 *   slot      continuous vertical strip between piers
 *   curtain   glazing dominates; only a spandrel band at each slab
 *   storefront full-height glazing (ground floors, retail)
 *   arched    grid with a headed top course
 *   blank     mostly solid wall, sparse openings
 *   open      no glazing at all (parking decks, canopies)
 */
export const WINDOW_FAMILIES = {
    regular_grid: { family: 'grid', width: 3, height: 2, sill: 1 },
    punched_window: { family: 'grid', width: 2, height: 2, sill: 1 },
    punched_with_chamfer: { family: 'grid', width: 3, height: 2, sill: 1, chamfer: true },
    double_hung: { family: 'grid', width: 2, height: 2, sill: 1 },
    tall_double_hung: { family: 'grid', width: 2, height: 3, sill: 1 },
    picture_window: { family: 'grid', width: 4, height: 2, sill: 1 },
    large_fixed: { family: 'grid', width: 4, height: 3, sill: 1 },
    art_glass_bay: { family: 'grid', width: 3, height: 2, sill: 1, bay: true },
    projecting_oriel_bay: { family: 'grid', width: 3, height: 2, sill: 1, bay: true },
    large_classroom_sash: { family: 'grid', width: 4, height: 3, sill: 1 },
    industrial_sash: { family: 'grid', width: 3, height: 3, sill: 1 },
    large_industrial_sash: { family: 'grid', width: 4, height: 3, sill: 1 },
    wide_bay_bronze_glass: { family: 'grid', width: 4, height: 3, sill: 1 },
    grid_with_x_bracing: { family: 'grid', width: 3, height: 2, sill: 1, bracing: true },
    radial_balcony_bays: { family: 'grid', width: 3, height: 2, sill: 1, balcony: true },
    tall_recessed_bay: { family: 'grid', width: 3, height: 3, sill: 1, recess: true },
    deep_recessed_slot: { family: 'slot', width: 2, sill: 1, recess: true },

    chicago_window: { family: 'ribbon', height: 2, sill: 1, pier: 1 },
    ribbon: { family: 'ribbon', height: 2, sill: 1, pier: 1 },
    continuous_ribbon: { family: 'ribbon', height: 2, sill: 1, pier: 0 },
    continuous_curved_glazing: { family: 'ribbon', height: 2, sill: 1, pier: 0 },
    open_spandrel_band: { family: 'open', height: 2, sill: 1 },

    vertical_slot: { family: 'slot', width: 2, sill: 0 },
    narrow_slot: { family: 'slot', width: 1, sill: 1 },
    sparse_slot: { family: 'blank', width: 1, height: 2, sill: 1, every: 3 },
    entry_glazing_only: { family: 'blank', width: 3, height: 2, sill: 1, every: 4 },

    floor_to_ceiling: { family: 'curtain', spandrel: 1 },
    full_glass_storefront: { family: 'storefront', spandrel: 0 },
    overhead_door_bays: { family: 'storefront', spandrel: 0, doors: true },
    tunnel_openings: { family: 'open', height: 3, sill: 0 },

    arched_romanesque: { family: 'arched', width: 3, height: 3, sill: 1 },
    monumental_arched: { family: 'arched', width: 4, height: 4, sill: 1 },
    gothic_lancet: { family: 'arched', width: 2, height: 4, sill: 1 }
}

export function windowSpec(pattern) {
    return WINDOW_FAMILIES[pattern] ?? WINDOW_FAMILIES.regular_grid
}

// --- massing ---------------------------------------------------------------

/**
 * Per-floor footprint, honouring setbacks. Floors are centred on the base
 * footprint so a setback reads as a symmetric step, which is what a stepped
 * tower actually looks like.
 */
export function floorPlates(entry) {
    const m = entry.massing
    const [bx, bz] = m.footprint
    const plates = []
    let current = [bx, bz]
    let y = 0

    for (let floor = 1; floor <= m.floors; floor++) {
        const setback = (m.setbacks ?? []).find((s) => s.at_floor === floor)
        if (setback) current = setback.footprint

        const height = floor === 1 ? (m.ground_floor_height ?? m.floor_height) : m.floor_height
        plates.push({
            floor,
            base: y,
            height,
            size: current,
            origin: [Math.floor((bx - current[0]) / 2), Math.floor((bz - current[1]) / 2)]
        })
        y += height
    }
    return plates
}

export function totalHeight(entry) {
    const plates = floorPlates(entry)
    const last = plates[plates.length - 1]
    const m = entry.massing
    const roofcap = m.roof.height ?? (m.roof.type === 'flat_mechanical' ? 8 : 0)
    const antenna = Math.max(0, ...(m.roof.antennas ?? []).map((a) => a.height))
    return last.base + last.height + roofcap + antenna
}

// --- facade ----------------------------------------------------------------

/**
 * Decide what a single wall cell is.
 *
 * @param u  distance along the wall from its start
 * @param v  height above the floor slab (0 is the slab course itself)
 * @param spec window family + parameters
 * @param ctx { interiorHeight, bay, isGround }
 * @returns 'wall' | 'glass' | 'frame' | 'trim' | 'accent' | 'open'
 */
export function facadeCell(u, v, spec, ctx) {
    const { interiorHeight, bay, isGround } = ctx

    if (v === 0) return 'trim' // structural slab band reads as a spandrel course
    if (isGround && spec.family !== 'open') {
        // Ground floors are glazier and taller than what is above them: a plinth
        // course, then shopfront glazing, then wall up to the first slab.
        if (v === 1) return 'base'
        if (v >= 2 && v <= interiorHeight - 1) return u % bay === 0 ? 'frame' : 'glass'
        return 'wall'
    }

    switch (spec.family) {
        case 'curtain': {
            if (v <= (spec.spandrel ?? 1)) return 'accent'
            return u % bay === 0 ? 'frame' : 'glass'
        }
        case 'storefront': {
            if (v >= 1 + (spec.spandrel ?? 0) && v <= interiorHeight - 1) {
                return u % bay === 0 ? 'frame' : 'glass'
            }
            return 'wall'
        }
        case 'ribbon': {
            const top = (spec.sill ?? 1) + (spec.height ?? 2)
            if (v > (spec.sill ?? 1) && v <= top) {
                if (spec.pier && u % bay === 0) return 'frame'
                return 'glass'
            }
            return 'wall'
        }
        case 'slot': {
            const inSlot = u % bay >= 1 && u % bay <= (spec.width ?? 2)
            if (!inSlot) return 'wall'
            if (v <= (spec.sill ?? 0)) return 'wall'
            if (v >= interiorHeight) return spec.recess ? 'accent' : 'wall'
            return 'glass'
        }
        case 'arched': {
            const inBay = u % bay >= 1 && u % bay <= (spec.width ?? 3)
            if (!inBay) return 'wall'
            const sill = spec.sill ?? 1
            const top = sill + (spec.height ?? 3)
            if (v <= sill || v > Math.min(top, interiorHeight)) return 'wall'
            // Head course arches in by one cell at each end.
            const atTop = v === Math.min(top, interiorHeight)
            const edge = u % bay === 1 || u % bay === (spec.width ?? 3)
            if (atTop && edge) return 'accent'
            return 'glass'
        }
        case 'blank': {
            const every = spec.every ?? 3
            const inBay = Math.floor(u / bay) % every === 0 && u % bay >= 1 && u % bay <= (spec.width ?? 1)
            if (!inBay) return 'wall'
            const sill = spec.sill ?? 1
            if (v <= sill || v > sill + (spec.height ?? 2)) return 'wall'
            return 'glass'
        }
        case 'open': {
            const sill = spec.sill ?? 1
            if (v <= sill) return 'wall'
            if (v > sill + (spec.height ?? 2)) return 'wall'
            return u % bay === 0 ? 'frame' : 'open'
        }
        case 'grid':
        default: {
            const inBay = u % bay >= 1 && u % bay <= (spec.width ?? 3)
            if (!inBay) return 'wall'
            const sill = spec.sill ?? 1
            const top = Math.min(sill + (spec.height ?? 2), interiorHeight)
            if (v <= sill || v > top) return 'wall'
            return 'glass'
        }
    }
}

// --- assembly --------------------------------------------------------------

const ROLE_FALLBACK = { open: null }

/** Roofs are dark and cluttered in real cities; a coloured lid reads as a toy. */
export const ROOFING = 'minecraft:deepslate_tiles'
export const ROOF_EQUIPMENT = 'minecraft:light_gray_concrete'

/**
 * Generate a complete building module from a catalog entry.
 *
 * @param entry catalog entry
 * @param options.interior  also emit floor slabs and core walls (default true)
 * @param options.shellOnly emit only the exterior skin — much smaller, for preview
 */
export function generateBuilding(entry, { interior = true, shellOnly = false } = {}) {
    const m = entry.massing
    const palette = MATERIALS[entry.facade.system]
    if (!palette) throw new Error(`${entry.id}: no palette binding for facade system "${entry.facade.system}"`)

    const spec = windowSpec(entry.facade.window_pattern)
    const bay = entry.structure?.bay ?? 5
    const plates = floorPlates(entry)
    const [bx, bz] = m.footprint
    const height = totalHeight(entry)

    const cells = new Map()
    const put = (x, y, z, block) => {
        if (!block) return
        if (x < 0 || z < 0 || x >= bx || z >= bz || y < 0 || y >= height) return
        cells.set(`${x},${y},${z}`, { pos: [x, y, z], block })
    }
    const material = (role) => palette[ROLE_FALLBACK[role] ?? role] ?? palette.wall

    // --- floors and skin
    for (const plate of plates) {
        const [sx, sz] = plate.size
        const [ox, oz] = plate.origin
        const interiorHeight = plate.height - 1
        const isGround = plate.floor === 1

        // Structural slab.
        if (interior && !shellOnly) {
            for (let x = 0; x < sx; x++) {
                for (let z = 0; z < sz; z++) put(ox + x, plate.base, oz + z, palette.trim)
            }
        }

        // Exterior skin, walked as a continuous perimeter so the bay rhythm
        // carries around corners instead of restarting on each face.
        const perimeter = []
        for (let x = 0; x < sx; x++) perimeter.push([ox + x, oz])
        for (let z = 1; z < sz; z++) perimeter.push([ox + sx - 1, oz + z])
        for (let x = sx - 2; x >= 0; x--) perimeter.push([ox + x, oz + sz - 1])
        for (let z = sz - 2; z >= 1; z--) perimeter.push([ox, oz + z])

        perimeter.forEach(([x, z], u) => {
            for (let v = 0; v <= interiorHeight; v++) {
                const role = facadeCell(u, v, spec, { interiorHeight, bay, isGround })
                if (role === 'open') continue
                put(x, plate.base + v, z, material(role))
            }
        })

        // Cornice: a trim course at the top of the topmost floor.
        if (plate.floor === m.floors && entry.facade.cornice && entry.facade.cornice !== 'none') {
            perimeter.forEach(([x, z]) => put(x, plate.base + interiorHeight, z, palette.trim))
        }

        // Vertical core, aligned across every floor.
        if (interior && !shellOnly && entry.structure?.core?.footprint) {
            const [cx, cz] = entry.structure.core.footprint
            const kx = Math.floor((bx - cx) / 2)
            const kz = Math.floor((bz - cz) / 2)
            for (let v = 1; v <= interiorHeight; v++) {
                for (let x = 0; x < cx; x++) {
                    put(kx + x, plate.base + v, kz, palette.accent)
                    put(kx + x, plate.base + v, kz + cz - 1, palette.accent)
                }
                for (let z = 1; z < cz - 1; z++) {
                    put(kx, plate.base + v, kz + z, palette.accent)
                    put(kx + cx - 1, plate.base + v, kz + z, palette.accent)
                }
            }
        }
    }

    // --- roof
    const top = plates[plates.length - 1]
    const roofBase = top.base + top.height
    buildRoof(entry, put, palette, top, roofBase)
    roofFeatures(entry, put, palette, top, roofBase)

    // --- antennas
    const roofcap = m.roof.height ?? (m.roof.type === 'flat_mechanical' ? 8 : 0)
    for (const [i, antenna] of (m.roof.antennas ?? []).entries()) {
        const count = antenna.count ?? 1
        const [sx, sz] = top.size
        for (let n = 0; n < count; n++) {
            const ax = top.origin[0] + Math.floor(sx / 2) + (n - (count - 1) / 2) * Math.max(2, Math.floor(sx / 4))
            const az = top.origin[1] + Math.floor(sz / 2) + i * 2
            for (let y = 0; y < antenna.height; y++) {
                put(Math.round(ax), roofBase + roofcap + y, Math.round(az), 'minecraft:iron_block')
            }
        }
    }

    const blocks = [...cells.values()].sort(
        (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]
    )

    return {
        id: entry.id,
        footprint: [bx, height, bz],
        category: 'building',
        connections: {},
        palette: {},
        blocks,
        block_entities: [],
        entities: []
    }
}

/**
 * Rooftop clutter, driven by the `roof.features` the catalog already declares.
 *
 * This is what stops a low building reading as a coloured lid. An empty roof
 * deck is the single most common tell that a Minecraft city was generated —
 * real roofs are covered in plant, tanks, bulkheads and signage.
 */
function roofFeatures(entry, put, palette, top, roofBase) {
    const features = entry.massing.roof.features ?? []
    if (!features.length) return

    const [sx, sz] = top.size
    const [ox, oz] = top.origin
    const cap = entry.massing.roof.height ?? 0
    const deckY = roofBase + (entry.massing.roof.type === 'flat_mechanical' ? cap : 1)

    const box = (x, z, w, d, h, block) => {
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < d; dz++) {
                for (let dy = 0; dy < h; dy++) put(ox + x + dx, deckY + dy, oz + z + dz, block)
            }
        }
    }
    const mast = (x, z, h, block) => {
        for (let dy = 0; dy < h; dy++) put(ox + x, deckY + dy, oz + z, block)
    }

    // Deterministic pseudo-placement: features land on a coarse grid seeded by
    // the building id, so the same building always produces the same roof.
    let seed = 0
    for (const ch of entry.id) seed = (seed * 31 + ch.charCodeAt(0)) & 0xffff
    const jitter = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed % Math.max(1, n)
    }

    for (const feature of features) {
        switch (feature) {
            case 'roof_hvac':
            case 'roof_vents':
                for (let n = 0; n < Math.max(1, Math.floor((sx * sz) / 400)); n++) {
                    box(2 + jitter(Math.max(1, sx - 8)), 2 + jitter(Math.max(1, sz - 8)), 3, 3, 2, ROOF_EQUIPMENT)
                }
                break
            case 'roof_hvac_array':
                for (let x = 3; x < sx - 5; x += 8) {
                    for (let z = 3; z < sz - 5; z += 8) box(x, z, 4, 3, 2, ROOF_EQUIPMENT)
                }
                break
            case 'equipment_penthouse':
            case 'freight_penthouse':
                box(Math.floor(sx / 3), Math.floor(sz / 3), Math.max(4, Math.floor(sx / 4)), Math.max(4, Math.floor(sz / 4)), 4, palette.wall)
                break
            case 'water_tower':
            case 'water_tank': {
                const wx = 2 + jitter(Math.max(1, sx - 8))
                const wz = 2 + jitter(Math.max(1, sz - 8))
                for (const [lx, lz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) mast(wx + lx, wz + lz, 4, 'minecraft:dark_oak_planks')
                box(wx, wz, 4, 4, 0, null)
                for (let dy = 4; dy < 9; dy++) {
                    for (let dx = 0; dx < 4; dx++) {
                        for (let dz = 0; dz < 4; dz++) {
                            put(ox + wx + dx, deckY + dy, oz + wz + dz, 'minecraft:dark_oak_planks')
                        }
                    }
                }
                break
            }
            case 'stair_bulkhead':
            case 'roof_hatch':
                box(Math.floor(sx / 2) - 2, Math.floor(sz / 2) - 2, 4, 4, 3, palette.wall)
                break
            case 'antenna_mast':
            case 'flagpole':
                mast(2 + jitter(Math.max(1, sx - 4)), 2 + jitter(Math.max(1, sz - 4)), feature === 'flagpole' ? 6 : 12, 'minecraft:iron_block')
                break
            case 'aviation_lights':
                for (const [cx, cz] of [[0, 0], [sx - 1, 0], [0, sz - 1], [sx - 1, sz - 1]]) {
                    put(ox + cx, deckY, oz + cz, 'minecraft:red_concrete')
                }
                break
            case 'light_poles':
                for (let x = 4; x < sx - 2; x += 10) {
                    for (let z = 4; z < sz - 2; z += 10) mast(x, z, 4, 'minecraft:iron_block')
                }
                break
            case 'skylights':
            case 'skylight_court':
                for (let x = 4; x < sx - 6; x += 10) {
                    for (let z = 4; z < sz - 6; z += 10) box(x, z, 5, 4, 1, palette.glass)
                }
                break
            case 'roof_deck':
            case 'open_top_deck':
                for (let x = 0; x < sx; x++) {
                    put(ox + x, deckY, oz, palette.trim)
                    put(ox + x, deckY, oz + sz - 1, palette.trim)
                }
                break
            case 'pool':
                box(Math.floor(sx / 2) - 3, Math.floor(sz / 2) - 3, 7, 5, 1, 'minecraft:light_blue_concrete')
                break
            case 'helipad':
                box(Math.floor(sx / 2) - 4, Math.floor(sz / 2) - 4, 9, 9, 1, 'minecraft:gray_concrete')
                box(Math.floor(sx / 2) - 1, Math.floor(sz / 2) - 1, 3, 3, 1, 'minecraft:white_concrete')
                break
            case 'sign_band':
            case 'illuminated_sign_band':
            case 'pylon_sign':
            case 'illuminated_price_sign':
            case 'station_sign':
                for (let x = Math.floor(sx / 4); x < Math.floor((3 * sx) / 4); x++) {
                    for (let dy = 0; dy < 2; dy++) put(ox + x, deckY + dy, oz, palette.accent)
                }
                break
            case 'vertical_blade_sign':
                for (let dy = 0; dy < 14; dy++) {
                    put(ox + Math.floor(sx / 2), deckY + dy, oz, palette.accent)
                    put(ox + Math.floor(sx / 2) + 1, deckY + dy, oz, palette.accent)
                }
                break
            case 'chimney':
            case 'chimney_stacks':
                box(2, 2, 2, 2, 4, 'minecraft:bricks')
                break
            case 'hose_tower':
            case 'bell_tower':
            case 'cupola':
                box(Math.floor(sx / 2) - 2, 1, 4, 4, feature === 'cupola' ? 4 : 10, palette.wall)
                break
            case 'window_washing_track':
                for (let x = 0; x < sx; x++) put(ox + x, deckY, oz + 1, 'minecraft:iron_block')
                break
            case 'rooftop_statue':
                box(Math.floor(sx / 2) - 1, Math.floor(sz / 2) - 1, 3, 3, 5, palette.accent)
                break
            default:
                break // facade features are handled on the wall, not the roof
        }
    }
}

function buildRoof(entry, put, palette, top, roofBase) {
    const type = entry.massing.roof.type
    const cap = entry.massing.roof.height ?? (type === 'flat_mechanical' ? 8 : 0)
    const [sx, sz] = top.size
    const [ox, oz] = top.origin

    const deck = (y, inset, block) => {
        for (let x = inset; x < sx - inset; x++) {
            for (let z = inset; z < sz - inset; z++) put(ox + x, y, oz + z, block)
        }
    }
    const ring = (y, inset, block) => {
        for (let x = inset; x < sx - inset; x++) {
            put(ox + x, y, oz + inset, block)
            put(ox + x, y, oz + sz - 1 - inset, block)
        }
        for (let z = inset; z < sz - inset; z++) {
            put(ox + inset, y, oz + z, block)
            put(ox + sx - 1 - inset, y, oz + z, block)
        }
    }

    deck(roofBase, 0, ROOFING)

    switch (type) {
        case 'flat_parapet':
            for (let y = 1; y <= Math.max(1, cap); y++) ring(roofBase + y, 0, palette.trim)
            break
        case 'flat_mechanical':
            for (let y = 1; y <= 2; y++) ring(roofBase + y, 0, palette.trim)
            // Equipment penthouse, set in from the parapet.
            for (let y = 1; y <= cap; y++) ring(roofBase + y, Math.max(2, Math.floor(sx / 6)), palette.accent)
            deck(roofBase + cap, Math.max(2, Math.floor(sx / 6)), palette.trim)
            break
        case 'setback_crown':
        case 'pyramid':
        case 'spire': {
            const steps = Math.max(1, cap)
            for (let y = 1; y <= steps; y++) {
                const inset = Math.floor((Math.min(sx, sz) / 2 - 1) * (y / steps))
                if (inset >= Math.min(sx, sz) / 2) break
                deck(roofBase + y, inset, y === steps ? palette.accent : palette.trim)
            }
            if (type === 'spire') {
                const cx = ox + Math.floor(sx / 2)
                const cz = oz + Math.floor(sz / 2)
                for (let y = 1; y <= cap; y++) put(cx, roofBase + steps + y, cz, palette.accent)
            }
            break
        }
        case 'gothic_crown':
            for (let y = 1; y <= cap; y++) ring(roofBase + y, 0, y % 2 ? palette.trim : palette.accent)
            // Corner pinnacles.
            for (const [px, pz] of [[0, 0], [sx - 1, 0], [0, sz - 1], [sx - 1, sz - 1]]) {
                for (let y = 1; y <= cap + 4; y++) put(ox + px, roofBase + y, oz + pz, palette.accent)
            }
            break
        case 'gable':
        case 'hip':
        case 'mansard': {
            const steps = Math.max(1, cap)
            for (let y = 1; y <= steps; y++) {
                const inset = type === 'gable' ? 0 : y
                if (inset * 2 >= Math.min(sx, sz)) break
                if (type === 'gable') {
                    for (let x = y; x < sx - y; x++) {
                        for (let z = 0; z < sz; z++) put(ox + x, roofBase + y, oz + z, palette.trim)
                    }
                } else {
                    deck(roofBase + y, inset, palette.trim)
                }
            }
            break
        }
        case 'barrel_vault':
            for (let y = 1; y <= cap; y++) {
                const inset = Math.round((Math.min(sx, sz) / 2) * (1 - Math.cos((y / cap) * (Math.PI / 2))))
                deck(roofBase + y, inset, palette.accent)
            }
            break
        case 'flytower':
            for (let y = 1; y <= cap; y++) ring(roofBase + y, Math.floor(sx / 4), palette.wall)
            break
        case 'canopy':
            for (let y = 1; y <= Math.max(1, cap); y++) ring(roofBase + y, 0, palette.trim)
            break
        default:
            for (let y = 1; y <= Math.max(1, cap); y++) ring(roofBase + y, 0, palette.trim)
    }
}
