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

import { buildInterior, coreRect } from './interior.mjs'

/**
 * Material bindings, injected rather than read from disk so this module runs
 * unchanged in Node and inside Bedrock's script engine. `tools/lib/materials.mjs`
 * loads them for build-time use; the behaviour pack passes its bundled copy.
 */
let MATERIALS = {}

export function setMaterials(systems) {
    MATERIALS = systems
}

export function getMaterials() {
    return MATERIALS
}

export { MATERIALS }

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

/** Types whose height is set by their span rather than by the catalog. */
const PITCHED = new Set(['gable', 'hip', 'mansard'])

/**
 * Rise of a pitched roof, in blocks. A 45-degree slope rises half its span, so
 * the roof comes to a proper ridge instead of a flat-topped stub.
 */
export function pitchedRise(entry) {
    const plates = floorPlates(entry)
    const [sx, sz] = plates[plates.length - 1].size
    const span = entry.massing.roof.type === 'gable' ? sx : Math.min(sx, sz)
    // Courses, not rise: a 9-wide hip needs five of them to close on a single
    // ridge line. Budgeting only four left the apex as a flat patch of tile.
    const full = Math.max(2, Math.ceil(span / 2))

    // A 45-degree hip over a 40-wide house rises twenty blocks, and no building
    // in the catalog looks like that. Where a rise is declared, honour it and
    // let the roof finish on a flat deck — a truncated hip, which is the real
    // form for a wide building and the reason mansards exist at all.
    const declared = entry.massing.roof.height
    return declared ? Math.max(2, Math.min(full, declared)) : full
}

export function roofCapFor(entry) {
    const roof = entry.massing.roof
    if (PITCHED.has(roof.type)) return pitchedRise(entry)
    return roof.height ?? (roof.type === 'flat_mechanical' ? 8 : 0)
}

export function totalHeight(entry) {
    const plates = floorPlates(entry)
    const last = plates[plates.length - 1]
    const m = entry.massing
    const roofcap = roofCapFor(entry)
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
    const { interiorHeight, bay, isGround, shopfront = true } = ctx

    if (v === 0) return 'trim' // structural slab band reads as a spandrel course
    if (isGround && spec.family !== 'open') {
        // A shopfront ground floor is glazier and taller than what is above it:
        // a plinth course, then glazing, then wall up to the first slab.
        //
        // A house is not a shop. Giving every building the same glazed base put
        // a storefront on the front of every bungalow in the catalog, which is
        // the single most obvious tell that a street was generated.
        if (v === 1) return 'base'
        if (shopfront) {
            if (v >= 2 && v <= interiorHeight - 1) return u % bay === 0 ? 'frame' : 'glass'
            return 'wall'
        }
        // Otherwise the ground floor is a wall with windows in it, on the same
        // bay rhythm as the floors above, headed a course below the top so a
        // cornice course cannot erase the only row of glazing.
        const head = interiorHeight - 1
        if (v > 1 && v <= head) {
            const inBay = u % bay >= 1 && u % bay <= (spec.width ?? 3)
            return inBay ? 'glass' : 'wall'
        }
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
 * Roofing kits. A pitched roof is built from the custom shingled roof blocks
 * (see tools/gen-blocks.mjs), which are genuine 45-degree wedges with a shingle
 * texture — not stacked cubes and not stairs.
 *
 * `full` fills the hidden core beneath the slope; `edge` forms the eaves course.
 */
export const ROOF_KITS = {
    slate: { material: 'slate', full: 'minecraft:deepslate_tiles', edge: 'minecraft:polished_deepslate' },
    clay_tile: { material: 'clay', full: 'minecraft:red_terracotta', edge: 'minecraft:terracotta' },
    wood_shake: { material: 'shake', full: 'minecraft:stripped_dark_oak_log', edge: 'minecraft:dark_oak_planks' },
    asphalt_shingle: { material: 'asphalt', full: 'minecraft:blackstone', edge: 'minecraft:polished_blackstone' },
    barrel_tile: { material: 'barrel', full: 'minecraft:terracotta', edge: 'minecraft:orange_terracotta' }
}

export const ROOF_BLOCKS = {
    slope: 'cb:roof_slope',
    ridge: 'cb:roof_ridge',
    hip: 'cb:roof_hip',
    fascia: 'cb:roof_fascia',
    dormer: 'cb:dormer'
}

/**
 * Every building carries a one-block margin on all four sides.
 *
 * Real buildings project past their structure — eaves overhang, cornices
 * corbel out, bay windows bulge, stoops reach the pavement. Without the margin
 * those blocks fall outside the module and are silently discarded, which is
 * exactly what was happening: the eaves course was being generated and then
 * thrown away on every building whose top floor was its full footprint.
 *
 * The module reports it as `margin`, so a city block can overlap neighbours by
 * that much and still have party walls meet.
 */
export const MARGIN = 1

/** Painted joinery tone, keyed to the roofing kit. */
export function trimToneFor(entry) {
    const material = roofKitFor(entry).material
    if (material === 'slate') return 'grey'
    if (material === 'shake') return 'wood'
    if (material === 'clay' || material === 'barrel') return 'cream'
    return 'white'
}

/** Cut-stone tone for cornices and stoops, taken from the facade's own wall. */
export function stoneToneFor(palette) {
    const wall = `${palette.wall ?? ''} ${palette.trim ?? ''}`
    if (/brick|terracotta|copper/.test(wall)) return 'terracotta'
    if (/brown|mud|dark_oak/.test(wall)) return 'brownstone'
    if (/deepslate|blackstone|basalt|tuff|gray|grey/.test(wall)) return 'granite'
    if (/concrete|smooth_stone|andesite/.test(wall)) return 'concrete'
    return 'limestone'
}

/**
 * Window families that get a framed window unit rather than a plain pane.
 *
 * A curtain wall really is a continuous sheet of glass, so it keeps the pane —
 * putting a sash frame on a Miesian tower would be wrong, not better.
 */
const FRAMED_WINDOW_FAMILIES = new Set(['grid', 'arched', 'blank', 'ribbon'])

/** Window frame colourway, inferred from the facade's own frame material. */
export function windowStyleFor(palette) {
    const frame = palette.frame ?? ''
    if (/black|deepslate|blackstone/.test(frame)) return 'black'
    if (/copper|brown|dark_oak|terracotta/.test(frame)) return 'bronze'
    if (/quartz|calcite|diorite|white|sandstone|birch/.test(frame)) return 'light'
    return 'dark'
}

/**
 * Whether the ground floor is a glazed shopfront or a solid base.
 *
 * Driven by the ground treatment the catalog already records, falling back on
 * the building type — a stoop, a portico or a carriage entrance means a wall
 * with a door in it, not a shop window.
 */
const SOLID_BASE = /stoop|portico|portal|courtyard|carriage|garage_and_entry|landscaped_entry|concrete_walk|porte_cochere|undercroft/

export function groundIsGlazed(entry) {
    const treatment = entry.facade?.ground_treatment ?? ''
    if (SOLID_BASE.test(treatment)) return false
    if (/storefront|retail|arcade|colonnade|marquee|box_office|showroom/.test(treatment)) return true
    return entry.type !== 'residential'
}

/** The way out of a wall cell, given the direction that wall faces. */
const OUTWARD = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }

/** Which kit a building roofs with, from its era. */
export function roofKitFor(entry) {
    const era = entry.provenance?.era ?? ''
    if (/gothic|romanesque|beaux_arts|neoclassical|civic|chicago_school/.test(era)) return ROOF_KITS.slate
    if (/beaux_arts|neoclassical|mediterranean|mission/.test(era)) return ROOF_KITS.barrel_tile
    if (/craftsman|vernacular|italianate|revival/.test(era)) return ROOF_KITS.clay_tile
    if (/postwar_suburban|roadside/.test(era)) return ROOF_KITS.asphalt_shingle
    if (/streamline|expressionist/.test(era)) return ROOF_KITS.wood_shake
    return ROOF_KITS.slate
}

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

    // Module extents: the structure plus the margin every projecting detail
    // needs. Building-local coordinates stay unshifted; `put` applies the offset
    // once, at the single point every block goes through.
    const width = bx + MARGIN * 2
    const depth = bz + MARGIN * 2

    const cells = new Map()
    const put = (x, y, z, block, state) => {
        if (!block) return
        x = Math.round(x) + MARGIN
        y = Math.round(y)
        z = Math.round(z) + MARGIN
        if (x < 0 || z < 0 || x >= width || z >= depth || y < 0 || y >= height) return
        const cell = { pos: [x, y, z], block }
        if (state) cell.state = state
        cells.set(`${x},${y},${z}`, cell)
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

        const shopfront = groundIsGlazed(entry)
        const framed = FRAMED_WINDOW_FAMILIES.has(spec.family)
        const windowStyle = windowStyleFor(palette)
        const trimTone = trimToneFor(entry)

        perimeter.forEach(([x, z], u) => {
            // Which way this cell faces, so a window unit is turned outward.
            const facing =
                z === oz ? 'north'
                : z === oz + sz - 1 ? 'south'
                : x === ox ? 'west'
                : 'east'

            for (let v = 0; v <= interiorHeight; v++) {
                const role = facadeCell(u, v, spec, { interiorHeight, bay, isGround, shopfront })
                if (role === 'open') continue

                if (role === 'glass' && framed && !isGround) {
                    put(x, plate.base + v, z, 'cb:window', {
                        'cb:style': windowStyle,
                        'minecraft:cardinal_direction': facing
                    })
                    continue
                }
                put(x, plate.base + v, z, material(role))
            }

            // Oriel and art-glass bays project past the wall. That is the whole
            // point of the pattern, and drawing them flat lost it.
            if (spec.bay && !isGround && u % (bay * 2) === Math.floor(bay / 2)) {
                const onCorner = (x === ox || x === ox + sx - 1) && (z === oz || z === oz + sz - 1)
                const [dx, dz] = OUTWARD[facing]
                if (!onCorner) {
                    for (let v = 1; v < interiorHeight; v++) {
                        if (facadeCell(u, v, spec, { interiorHeight, bay, isGround, shopfront }) !== 'glass') continue
                        put(x + dx, plate.base + v, z + dz, 'cb:bay_window', {
                            'cb:tone': trimTone,
                            'minecraft:cardinal_direction': facing
                        })
                    }
                }
            }
        })

        // Cornice. A crown course in the wall plane, plus a corbelled moulding
        // ring projecting past it — a cornice that does not project is just a
        // stripe of a different colour.
        if (plate.floor === m.floors && entry.facade.cornice && entry.facade.cornice !== 'none') {
            const y = plate.base + interiorHeight
            perimeter.forEach(([x, z]) => put(x, y, z, palette.trim))

            if (!PITCHED.has(m.roof.type)) {
                const stone = stoneToneFor(palette)
                const crown = (x, z, dir) =>
                    put(x, y, z, 'cb:cornice', { 'cb:stone': stone, 'minecraft:cardinal_direction': dir })
                for (let x = ox - 1; x <= ox + sx; x++) {
                    crown(x, oz - 1, 'north')
                    crown(x, oz + sz, 'south')
                }
                for (let z = oz; z < oz + sz; z++) {
                    crown(ox - 1, z, 'west')
                    crown(ox + sx, z, 'east')
                }
            }
        }

    }

    // Interiors run after the shell: hollowing clears the volume, so anything
    // placed inside must come afterwards or it is erased.
    //
    // `free` reports cells the shell left empty, so the fitout can furnish a
    // room without overwriting a stair, a partition, a door or a lift shaft.
    const free = (x, y, z) => {
        const cell = cells.get(`${Math.round(x) + MARGIN},${Math.round(y)},${Math.round(z) + MARGIN}`)
        return cell !== undefined && cell.block === 'minecraft:air'
    }

    if (interior && !shellOnly) buildInterior(entry, put, palette, plates, [bx, bz], free)

    entrancePorch(entry, put, palette, plates)

    // --- roof
    const top = plates[plates.length - 1]
    const roofBase = top.base + top.height
    buildRoof(entry, put, palette, top, roofBase)
    roofFeatures(entry, put, palette, top, roofBase)

    // --- antennas
    const roofcap = roofCapFor(entry)
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
        footprint: [width, height, depth],
        margin: MARGIN,
        category: 'building',
        connections: {},
        palette: {},
        blocks,
        block_entities: [],
        entities: []
    }
}

/**
 * Steps up to the door, and a porch over them on a house.
 *
 * The entrances the interior cuts are at the middle of both short faces; this
 * lines the stoop up with them, so the way in reads as a way in from outside
 * rather than as a hole in a wall of glass.
 */
function entrancePorch(entry, put, palette, plates) {
    const ground = plates[0]
    const [sx, sz] = ground.size
    const [ox, oz] = ground.origin
    const cx = ox + Math.floor(sx / 2)
    const stone = stoneToneFor(palette)
    const tone = trimToneFor(entry)
    const half = Math.floor(Math.max(2, Math.min(6, Math.floor(sx / 8))) / 2)

    // A porch belongs on a house, not on the front of a forty-storey tower.
    const porch = PITCHED.has(entry.massing.roof.type) && entry.massing.floors <= 4
    const kit = roofKitFor(entry)

    for (const [z, dir] of [[oz - 1, 'north'], [oz + sz, 'south']]) {
        for (let dx = -half; dx <= half; dx++) {
            put(cx + dx, ground.base, z, 'cb:stoop', {
                'cb:stone': stone,
                'minecraft:cardinal_direction': dir
            })
        }
        if (!porch) continue

        for (const dx of [-half - 1, half + 1]) {
            for (let v = 1; v <= 3; v++) {
                put(cx + dx, ground.base + v, z, 'cb:porch_post', { 'cb:tone': tone })
            }
            put(cx + dx, ground.base, z, 'cb:stoop', { 'cb:stone': stone, 'minecraft:cardinal_direction': dir })
        }
        // Porch roof, tucked under the eaves line — one course higher and it
        // stands proud of the roof it is supposed to shelter under.
        const head = ground.base + ground.height - 1
        for (let dx = -half - 1; dx <= half + 1; dx++) put(cx + dx, head, z, kit.edge)
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
    const cap = roofCapFor(entry)
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
    const cap = roofCapFor(entry)
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
        case 'mansard':
            pitchedRoof(entry, put, top, roofBase, type, cap)
            break
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


/**
 * Where the lift shaft is and which Y each floor lands on, in building-local
 * coordinates. The runtime registers this when a building is placed so the
 * elevator knows its stops without re-deriving them (SPEC.md M5).
 */
export function verticalRegistry(entry) {
    const plates = floorPlates(entry)
    const footprint = entry.massing.footprint
    const core = coreRect(entry, footprint)

    const lifts = (entry.vertical?.passenger_elevators ?? 0) + (entry.vertical?.service_elevators ?? 0)
    const stairD = Math.min(core.d, 7)
    const shaftD = lifts > 0 ? Math.max(0, core.d - stairD) : 0

    return {
        hasLift: shaftD > 0,
        // Module coordinates, so the runtime can use these directly: the
        // generator offsets every block by MARGIN and the shaft moves with it.
        shaft: shaftD > 0
            ? {
                x: core.x + 1 + MARGIN,
                z: core.z + stairD + MARGIN,
                w: Math.max(1, core.w - 2),
                d: Math.max(1, shaftD - 1)
            }
            : null,
        stops: plates.map((plate) => ({
            floor: plate.floor,
            y: plate.base + 1,
            use: (entry.program ?? []).find((b) => plate.floor >= b.floors[0] && plate.floor <= b.floors[1])?.use ?? ''
        }))
    }
}


/**
 * A pitched roof made of the custom shingled roof blocks.
 *
 * Each course steps inward and up. The perimeter of the course is slope blocks
 * turned to face outward, the corners are hips where two slopes meet, the
 * interior is filled solid so no daylight shows through, and the apex is capped
 * with ridge tiles.
 */
function pitchedRoof(entry, put, top, roofBase, type, cap) {
    const kit = roofKitFor(entry)
    const [sx, sz] = top.size
    const [ox, oz] = top.origin
    const facing = (dir) => ({ 'cb:material': kit.material, 'minecraft:cardinal_direction': dir })
    const tone = trimToneFor(entry)

    const gable = type === 'gable'
    const limit = Math.ceil((gable ? sx : Math.min(sx, sz)) / 2)
    const steps = Math.max(1, Math.min(cap, limit))

    // Eaves. The roof plane continues one course *below* the first course and
    // one cell out, so the overhang is the same slope carried past the wall —
    // not a square lip stuck on the side, which is what a solid ring at roof
    // level looked like. A fascia and soffit close the underside.
    const eaveY = roofBase - 1
    const eave = (x, z, dir) => {
        put(ox + x, eaveY, oz + z, ROOF_BLOCKS.slope, facing(dir))
        put(ox + x, eaveY - 1, oz + z, ROOF_BLOCKS.fascia, {
            'cb:tone': tone,
            'minecraft:cardinal_direction': dir
        })
    }

    for (let z = gable ? -1 : 0; z < (gable ? sz + 1 : sz); z++) {
        eave(-1, z, 'west')
        eave(sx, z, 'east')
    }
    if (!gable) {
        for (let x = 0; x < sx; x++) {
            eave(x, -1, 'north')
            eave(x, sz, 'south')
        }
        put(ox - 1, eaveY, oz - 1, ROOF_BLOCKS.hip, facing('north'))
        put(ox + sx, eaveY, oz - 1, ROOF_BLOCKS.hip, facing('east'))
        put(ox - 1, eaveY, oz + sz, ROOF_BLOCKS.hip, facing('west'))
        put(ox + sx, eaveY, oz + sz, ROOF_BLOCKS.hip, facing('south'))
    }

    for (let step = 0; step < steps; step++) {
        const y = roofBase + step
        const xLo = step
        const xHi = sx - 1 - step
        const zLo = gable ? 0 : step
        const zHi = gable ? sz - 1 : sz - 1 - step
        if (xLo > xHi || zLo > zHi) break

        for (let x = xLo; x <= xHi; x++) {
            for (let z = zLo; z <= zHi; z++) put(ox + x, y, oz + z, kit.full)
        }

        for (let z = zLo; z <= zHi; z++) {
            put(ox + xLo, y, oz + z, ROOF_BLOCKS.slope, facing('west'))
            put(ox + xHi, y, oz + z, ROOF_BLOCKS.slope, facing('east'))
        }
        if (!gable) {
            for (let x = xLo; x <= xHi; x++) {
                put(ox + x, y, oz + zLo, ROOF_BLOCKS.slope, facing('north'))
                put(ox + x, y, oz + zHi, ROOF_BLOCKS.slope, facing('south'))
            }
            put(ox + xLo, y, oz + zLo, ROOF_BLOCKS.hip, facing('north'))
            put(ox + xHi, y, oz + zLo, ROOF_BLOCKS.hip, facing('east'))
            put(ox + xLo, y, oz + zHi, ROOF_BLOCKS.hip, facing('west'))
            put(ox + xHi, y, oz + zHi, ROOF_BLOCKS.hip, facing('south'))
        }
    }

    dormers(put, ox, oz, sx, sz, roofBase, steps, gable, tone)

    const ridgeY = roofBase + steps - 1
    const rxLo = steps - 1
    const rxHi = sx - steps
    const rzLo = gable ? 0 : steps - 1
    const rzHi = gable ? sz - 1 : sz - steps
    if (rxLo > rxHi || rzLo > rzHi) return

    const wideX = rxHi - rxLo >= 1
    const wideZ = rzHi - rzLo >= 1

    if (wideX && wideZ && !gable) {
        // A truncated hip: the roof stops short of a ridge and finishes on a
        // flat deck, ringed with ridge tiles. Filling the whole apex with ridge
        // caps instead gave a raised slab of tile several cells across.
        for (let x = rxLo; x <= rxHi; x++) {
            for (let z = rzLo; z <= rzHi; z++) put(ox + x, ridgeY, oz + z, kit.edge)
        }
        for (let x = rxLo; x <= rxHi; x++) {
            put(ox + x, ridgeY, oz + rzLo, ROOF_BLOCKS.ridge, facing('north'))
            put(ox + x, ridgeY, oz + rzHi, ROOF_BLOCKS.ridge, facing('north'))
        }
        for (let z = rzLo; z <= rzHi; z++) {
            put(ox + rxLo, ridgeY, oz + z, ROOF_BLOCKS.ridge, facing('east'))
            put(ox + rxHi, ridgeY, oz + z, ROOF_BLOCKS.ridge, facing('east'))
        }
        return
    }

    const alongX = rxHi - rxLo >= rzHi - rzLo
    for (let x = rxLo; x <= rxHi; x++) {
        for (let z = rzLo; z <= rzHi; z++) {
            put(ox + x, ridgeY, oz + z, ROOF_BLOCKS.ridge, facing(alongX ? 'north' : 'east'))
        }
    }
}

/**
 * Dormers, set into the roof plane a course up from the eaves.
 *
 * A big hip or gable roof with nothing on it is an unbroken field of tile, and
 * that flatness is what makes a generated roof look generated. Real roofs of
 * this size are punctuated — so these go in on any slope with room for them.
 */
function dormers(put, ox, oz, sx, sz, roofBase, steps, gable, tone) {
    if (steps < 3) return

    const step = steps >= 4 ? 1 : 0
    const y = roofBase + step
    const xLo = step
    const xHi = sx - 1 - step
    const zLo = gable ? 0 : step
    const zHi = gable ? sz - 1 : sz - 1 - step

    const set = (x, z, dir) =>
        put(ox + x, y, oz + z, ROOF_BLOCKS.dormer, { 'cb:tone': tone, 'minecraft:cardinal_direction': dir })

    // Only the long elevation gets dormers — a house with them on all four
    // sides reads as a doll's house, not a roof.
    const runZ = zHi - zLo + 1
    const runX = xHi - xLo + 1

    // Three clear cells at each end, so a dormer never lands on a hip, and no
    // more than four to a side — a row of them every few blocks reads as a
    // dotted line, not as windows.
    const along = (run) => {
        const usable = run - 6
        if (usable < 1) return []
        const count = Math.min(4, 1 + Math.floor(usable / 8))
        const gap = usable / count
        return Array.from({ length: count }, (_, i) => Math.round(3 + gap * (i + 0.5) - gap / 2))
    }

    if (gable || runZ >= runX) {
        for (const offset of along(runZ)) {
            set(xLo, zLo + offset, 'west')
            set(xHi, zLo + offset, 'east')
        }
    } else {
        for (const offset of along(runX)) {
            set(xLo + offset, zLo, 'north')
            set(xLo + offset, zHi, 'south')
        }
    }
}
