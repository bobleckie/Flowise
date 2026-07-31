#!/usr/bin/env node
/**
 * Generate the custom block library: behaviour-pack block definitions,
 * resource-pack geometry, and procedural textures.
 *
 * Vanilla Minecraft has no angled roof block — stairs are the closest it gets,
 * and stairs read as steps, not shingles. Bedrock does support custom blocks
 * with arbitrary geometry, so this builds real ones: a 45-degree shingled
 * slope, ridge caps, wall sconces, chandeliers, framed art, and furniture with
 * actual arms, backs and legs rather than a coloured cube.
 *
 * Everything here is generated from the SPEC table below, so a new block is a
 * few lines of data rather than four hand-edited files.
 *
 *   node tools/gen-blocks.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    shingle, shake, barrelTile, window as windowTex, ridge, fabric, wood, metal,
    glowPanel, framedArt, panel, clapboard, ashlar
} from './lib/textures.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BP = join(ROOT, 'packs', 'city_builder_bp')
const RP = join(ROOT, 'packs', 'city_builder_rp')

const BLOCK_FORMAT = '1.21.10'
const GEO_FORMAT = '1.12.0'

// --- geometry helpers ------------------------------------------------------

const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down']

/**
 * Per-face UV covering the whole 16x16 texture, so patterns tile cleanly.
 *
 * `faces` optionally names a material instance per face — `{ north: 'glass' }`
 * puts glazing on one side of a cube and siding on the rest, which is what lets
 * a single-block dormer or bay window carry a real window.
 */
function fullUv(faces = {}) {
    const uv = {}
    for (const name of FACE_NAMES) {
        const instance = faces[name] ?? faces['*']
        uv[name] = instance ? { uv: [0, 0], uv_size: [16, 16], material_instance: instance } : { uv: [0, 0], uv_size: [16, 16] }
    }
    return uv
}

function cube(origin, size, extra = {}) {
    const { faces, ...rest } = extra
    return { origin, size, uv: fullUv(faces), ...rest }
}

function geometry(identifier, cubes, bounds = [2, 2, 2]) {
    return {
        description: {
            identifier,
            texture_width: 16,
            texture_height: 16,
            visible_bounds_width: bounds[0],
            visible_bounds_height: bounds[1],
            visible_bounds_offset: [0, bounds[2] / 2, 0]
        },
        bones: [{ name: 'root', pivot: [0, 0, 0], cubes }]
    }
}

/**
 * A true 45-degree slope: one plate, rotated, spanning the block corner to
 * corner. The diagonal of a 16x16 block is 22.63, hence the length.
 *
 * The slope rises toward +Z (south) at rest; the cardinal-direction
 * permutations below turn it to face any way. If it ever renders sloping the
 * wrong way, flip the sign of this rotation — that is the only thing that
 * controls it.
 */
const SLOPE_ROTATION = -45
const DIAGONAL = 22.63

/**
 * Facing convention: **a block's front is its -Z face.**
 *
 * `cb:roof_slope` rises toward +Z at rest, so its eave — the side you look at —
 * is at -Z, and the generator places that course facing north (rotation 0).
 * North is -Z in Minecraft, so front-at--Z is the only convention under which
 * "facing north" and "unrotated" mean the same thing.
 *
 * Everything with a front must follow it. The window, the framed art and the
 * screen were built the other way round, which put every window frame, sill and
 * head on the *inside* of the building and hung every picture facing the wall.
 */

/**
 * Half-plates for a hip corner.
 *
 * A hip is where two slopes meet, and its surface is the *lower* of the two
 * planes — that is what makes it a ridge running out to the corner. Unioning
 * two whole plates gives the *higher* one instead, so every hip block bulged
 * above its neighbours and the hip line came out as a row of diamonds.
 *
 * Each plate is therefore sliced into strips and clipped at the diagonal, so it
 * only covers the half of the block where its own plane is the lower one. The
 * strips leave a one-unit jog on the diagonal itself — a sixteenth of a block,
 * and both planes are the same height there anyway.
 */
const STRIP = 1

function hipPlates() {
    const cubes = []
    for (let k = 0; k < 16 / STRIP; k++) {
        const far = -8 + STRIP * k + STRIP // the diagonal at this strip's far edge
        const length = Math.SQRT2 * far + 11.31

        // Rising toward +x, covering the half where x is the lower plane.
        cubes.push(cube([-11.31, 6.5, -8 + STRIP * k], [length, 3, STRIP], {
            pivot: [0, 8, 0], rotation: [0, 0, -SLOPE_ROTATION]
        }))
        // Rising toward +z, covering the other half.
        cubes.push(cube([-8 + STRIP * k, 6.5, -11.31], [STRIP, 3, length], {
            pivot: [0, 8, 0], rotation: [SLOPE_ROTATION, 0, 0]
        }))
    }
    return cubes
}

/**
 * Solid structure beneath a roof plane.
 *
 * A bare rotated plate leaves the whole lower triangle of its block hollow, and
 * on every perimeter course you could see straight through that hollow to the
 * side of the block behind — a dark notch under each course, which is precisely
 * the "still looks like stairs" artefact. The plane was right; the roof simply
 * had no substance under it.
 *
 * Two-unit steps, always finishing below the plate's underside, so the stepping
 * is buried inside the roof and never breaks the surface.
 */
function slopeFill({ corner = false } = {}) {
    const cubes = []
    for (let j = 1; j < 8; j++) {
        const top = 2 * j
        const from = -8 + 2 * j
        cubes.push(corner ? cube([from, 0, from], [16 - 2 * j, top, 16 - 2 * j]) : cube([-8, 0, from], [16, top, 16 - 2 * j]))
    }
    return cubes
}

const GEOMETRIES = {
    'geometry.cb_roof_slope': geometry('geometry.cb_roof_slope', [
        cube([-8, 6.5, -11.31], [16, 3, DIAGONAL], { pivot: [0, 8, 0], rotation: [SLOPE_ROTATION, 0, 0] }),
        ...slopeFill()
    ], [2, 2, 2]),

    // Ridge cap: a rolled half-round tile bedded on a mortar course, which is
    // what a real ridge is. The previous cap was three stacked slabs and read as
    // a raised bar down the apex.
    //
    // The roll is an octagon — a box plus the same box turned 45 degrees — and
    // the bedding course underneath is wide enough to close the gap where the
    // two slopes stop short of the apex.
    'geometry.cb_roof_ridge': geometry('geometry.cb_roof_ridge', [
        cube([-8, 0, -8], [16, 4, 16]), // bedding course, closing the apex
        cube([-8, 4, -5], [16, 8, 10]),
        cube([-8, 4, -5], [16, 8, 10], { pivot: [0, 8, 0], rotation: [45, 0, 0] })
    ]),

    // Eaves fascia and soffit, hung under the roof overhang. Without it the
    // underside of the overhang is open and the roof edge reads as a row of
    // tile ends — the sawtooth.
    'geometry.cb_roof_fascia': geometry('geometry.cb_roof_fascia', [
        cube([-8, 8, -8], [16, 8, 2]), // fascia board, on the outer face
        cube([-8, 8, -6], [16, 2, 14]) // soffit, closing the overhang from below
    ]),

    // Gabled dormer. The front face carries real glazing through a named
    // material instance, so one block reads as a window in a roof rather than a
    // bump.
    'geometry.cb_dormer': geometry('geometry.cb_dormer', [
        cube([-7, 0, -8], [2, 11, 10]), // cheek, left
        cube([5, 0, -8], [2, 11, 10]), // cheek, right
        cube([-5, 0, -8], [10, 2, 2]), // apron under the sill
        cube([-5, 2, -8], [10, 8, 2], { faces: { north: 'glass', south: 'glass' } }),
        cube([-5, 10, -8], [10, 2, 2]), // head
        cube([-4, 12, -8], [8, 2, 2]), // gable, stepped to the peak
        cube([-2, 14, -8], [4, 2, 2]),
        // Roof: two plates at 22.5 degrees meeting on a ridge at x = 0.
        cube([-7.29, 11.45, -8], [7.57, 2, 10], { pivot: [-3.5, 12.45, 0], rotation: [0, 0, 22.5] }),
        cube([-0.28, 11.45, -8], [7.57, 2, 10], { pivot: [3.5, 12.45, 0], rotation: [0, 0, -22.5] })
    ], [3, 3, 3]),

    // Canted bay window: a flat front pane with two angled cheeks, on an apron,
    // under a lead cap. Sits in the cell outside the wall it belongs to.
    'geometry.cb_bay_window': geometry('geometry.cb_bay_window', [
        cube([-8, 0, -6], [16, 2, 14]), // apron
        cube([-5, 2, -8], [10, 12, 2], { faces: { north: 'glass', south: 'glass' } }),
        cube([-8.62, 2, -7.5], [4.24, 12, 2], {
            pivot: [-6.5, 8, -6.5], rotation: [0, 45, 0], faces: { north: 'glass', south: 'glass' }
        }),
        cube([4.38, 2, -7.5], [4.24, 12, 2], {
            pivot: [6.5, 8, -6.5], rotation: [0, -45, 0], faces: { north: 'glass', south: 'glass' }
        }),
        cube([-8, 14, -6], [16, 2, 14]) // cap
    ], [3, 3, 3]),

    // Cornice: a corbelled crown course. A cornice is stepped mouldings, so the
    // steps are the point — what it replaces was a flat band of trim.
    'geometry.cb_cornice': geometry('geometry.cb_cornice', [
        cube([-8, 0, -4], [16, 5, 12]), // bed mould
        cube([-8, 5, -6], [16, 4, 14]),
        cube([-8, 9, -8], [16, 4, 16]), // corona, at full projection
        cube([-8, 13, -6], [16, 3, 14]) // cyma, setting back above
    ]),

    // Front steps. Three treads falling toward the street.
    'geometry.cb_stoop': geometry('geometry.cb_stoop', [
        cube([-8, 0, -8], [16, 5, 16]),
        cube([-8, 5, -3], [16, 5, 11]),
        cube([-8, 10, 2], [16, 6, 6])
    ]),

    // Porch column: base, shaft, capital.
    'geometry.cb_porch_post': geometry('geometry.cb_porch_post', [
        cube([-4, 0, -4], [8, 2, 8]),
        cube([-3, 2, -3], [6, 12, 6]),
        cube([-4, 14, -4], [8, 2, 8])
    ]),

    // Hip: where two slopes meet on a diagonal. Built as the union of a
    // north-facing slope (rotated about X) and a west-facing one (about Z), so
    // each cube still rotates on a single axis as Bedrock requires.
    'geometry.cb_roof_hip': geometry('geometry.cb_roof_hip', [
        ...hipPlates(),
        // Solid under the surface, stepping with whichever direction is lower.
        ...slopeFill({ corner: true })
    ]),

    // Wall sconce: backplate, arm, shade.
    'geometry.cb_sconce': geometry('geometry.cb_sconce', [
        cube([-3, 5, 6], [6, 7, 2]), // backplate against the wall
        cube([-1, 8, 3], [2, 2, 3]), // arm
        cube([-3, 9, 1], [6, 5, 5]) // shade
    ]),

    // Chandelier: stem, ring, four candles.
    'geometry.cb_chandelier': geometry('geometry.cb_chandelier', [
        cube([-1, 11, -1], [2, 5, 2]), // stem to ceiling
        cube([-6, 9, -6], [12, 2, 12]), // ring
        cube([-6, 11, -6], [3, 3, 3]),
        cube([3, 11, -6], [3, 3, 3]),
        cube([-6, 11, 3], [3, 3, 3]),
        cube([3, 11, 3], [3, 3, 3])
    ]),

    // Flush ceiling panel.
    'geometry.cb_ceiling_light': geometry('geometry.cb_ceiling_light', [cube([-7, 15, -7], [14, 1, 14])]),

    // Pendant over a table.
    'geometry.cb_pendant': geometry('geometry.cb_pendant', [
        cube([-1, 10, -1], [2, 6, 2]),
        cube([-4, 7, -4], [8, 3, 8])
    ]),

    // Framed art: a thin panel standing off the wall, facing into the room.
    'geometry.cb_wall_art': geometry('geometry.cb_wall_art', [cube([-7, 4, -8], [14, 10, 1])]),

    // Sofa: seat, back, two arms.
    'geometry.cb_sofa': geometry('geometry.cb_sofa', [
        cube([-8, 3, -6], [16, 4, 12]), // seat
        cube([-8, 0, -6], [16, 3, 12]), // plinth
        cube([-8, 7, 2], [16, 7, 4]), // back
        cube([-8, 7, -6], [3, 5, 8]), // left arm
        cube([5, 7, -6], [3, 5, 8]) // right arm
    ]),

    'geometry.cb_armchair': geometry('geometry.cb_armchair', [
        cube([-6, 3, -5], [12, 4, 10]),
        cube([-6, 0, -5], [12, 3, 10]),
        cube([-6, 7, 2], [12, 7, 3]),
        cube([-6, 7, -5], [2, 5, 7]),
        cube([4, 7, -5], [2, 5, 7])
    ]),

    // Desk: top on two pedestals, with a modesty panel.
    'geometry.cb_desk': geometry('geometry.cb_desk', [
        cube([-8, 12, -8], [16, 2, 16]), // top
        cube([-8, 0, -7], [5, 12, 14]), // left pedestal
        cube([3, 0, -7], [5, 12, 14]), // right pedestal
        cube([-3, 4, 6], [6, 8, 1]) // modesty panel
    ]),

    // Dining table: top on four legs.
    'geometry.cb_table': geometry('geometry.cb_table', [
        cube([-8, 12, -8], [16, 2, 16]),
        cube([-7, 0, -7], [2, 12, 2]),
        cube([5, 0, -7], [2, 12, 2]),
        cube([-7, 0, 5], [2, 12, 2]),
        cube([5, 0, 5], [2, 12, 2])
    ]),

    // Kitchen / reception counter: carcass with an overhanging worktop.
    'geometry.cb_counter': geometry('geometry.cb_counter', [
        cube([-8, 0, -6], [16, 13, 13]),
        cube([-8, 13, -8], [16, 3, 16])
    ]),

    // Screen on a stand, facing into the room.
    'geometry.cb_screen': geometry('geometry.cb_screen', [
        cube([-7, 4, -7], [14, 9, 1]),
        cube([-2, 1, -8], [4, 3, 3]),
        cube([-5, 0, -8], [10, 1, 4])
    ]),

    // Shelving with visible books.
    'geometry.cb_bookcase': geometry('geometry.cb_bookcase', [
        cube([-8, 0, 3], [16, 16, 5]),
        cube([-7, 2, 1], [14, 4, 2]),
        cube([-7, 8, 1], [14, 4, 2])
    ]),

    // Window: a recessed light in a frame, with a projecting sill and a reveal
    // to either side. Depth is what stops a window reading as a painted-on pane.
    'geometry.cb_window': geometry('geometry.cb_window', [
        cube([-8, 0, -7], [16, 16, 2]), // the glazed panel, set back in the wall
        cube([-8, 0, -8], [2, 16, 1]), // reveal, left
        cube([6, 0, -8], [2, 16, 1]), // reveal, right
        cube([-8, 14, -8], [16, 2, 1]), // head
        cube([-8, 0, -8], [16, 3, 1]) // sill
    ]),

    // Planter.
    'geometry.cb_planter': geometry('geometry.cb_planter', [
        cube([-5, 0, -5], [10, 6, 10]),
        cube([-3, 6, -3], [6, 8, 6])
    ])
}

// --- texture set -----------------------------------------------------------

const SHINGLE_COLORS = {
    slate: [72, 78, 88],
    clay: [150, 78, 54],
    shake: [96, 72, 46],
    asphalt: [54, 54, 58],
    barrel: [172, 96, 58]
}

const TEXTURES = {}

for (const [name, color] of Object.entries(SHINGLE_COLORS)) {
    // Wooden shakes are longer and more irregular than slate or clay tiles.
    TEXTURES[`cb_shingle_${name}`] =
        name === 'shake' ? shake(`shingle_${name}`, color)
        : name === 'barrel' ? barrelTile(`shingle_${name}`, color)
        : shingle(`shingle_${name}`, color)
    TEXTURES[`cb_ridge_${name}`] = ridge(`ridge_${name}`, color)
}

/**
 * Painted joinery — fascias, soffits, dormer cheeks, porch posts. Keyed to the
 * roofing kit so a slate roof gets grey boards and a clay one gets cream.
 */
export const TRIM_TONES = {
    white: [226, 224, 216],
    cream: [214, 200, 172],
    grey: [128, 132, 138],
    wood: [118, 88, 58]
}
for (const [tone, color] of Object.entries(TRIM_TONES)) {
    TEXTURES[`cb_trim_${tone}`] = clapboard(`trim_${tone}`, color)
}

/** Cut stone, for cornices and stoops. */
export const STONE_TONES = {
    limestone: [206, 198, 178],
    granite: [126, 126, 128],
    brownstone: [130, 88, 62],
    terracotta: [176, 118, 86],
    concrete: [170, 168, 162]
}
for (const [tone, color] of Object.entries(STONE_TONES)) {
    TEXTURES[`cb_stone_${tone}`] = ashlar(`stone_${tone}`, color)
}

TEXTURES.cb_brass = metal('brass', [176, 138, 66])
TEXTURES.cb_glow_warm = glowPanel('glow_warm', [255, 236, 190], [92, 76, 52])
TEXTURES.cb_glow_cool = glowPanel('glow_cool', [232, 244, 255], [140, 148, 158])
TEXTURES.cb_fabric_charcoal = fabric('fabric_charcoal', [64, 66, 72])
TEXTURES.cb_fabric_olive = fabric('fabric_olive', [96, 100, 66])
TEXTURES.cb_fabric_rust = fabric('fabric_rust', [140, 74, 52])
TEXTURES.cb_fabric_cream = fabric('fabric_cream', [196, 184, 158])
TEXTURES.cb_wood_walnut = wood('wood_walnut', [86, 60, 40])
TEXTURES.cb_wood_oak = wood('wood_oak', [162, 130, 84])
TEXTURES.cb_stone_worktop = metal('worktop', [186, 186, 182])
TEXTURES.cb_screen_dark = panel('screen', [22, 24, 30], [44, 46, 52])
TEXTURES.cb_planter = wood('planter', [110, 84, 60])
TEXTURES.cb_foliage = fabric('foliage', [72, 108, 56], { seam: false })

const WINDOW_STYLES = {
    dark: [[46, 48, 54], [150, 190, 208]],
    light: [[224, 222, 214], [168, 200, 214]],
    bronze: [[122, 88, 52], [140, 152, 130]],
    black: [[24, 25, 30], [96, 118, 134]]
}
for (const [style, [frameColor, glassColor]] of Object.entries(WINDOW_STYLES)) {
    TEXTURES[`cb_window_${style}`] = windowTex(`window_${style}`, frameColor, glassColor)
}

for (let variant = 0; variant < 5; variant++) {
    TEXTURES[`cb_art_${variant}`] = framedArt('art', variant, [92, 68, 44])
}

// --- block definitions -----------------------------------------------------

const CARDINAL_TRAIT = {
    'minecraft:placement_direction': { enabled_states: ['minecraft:cardinal_direction'], y_rotation_offset: 180 }
}

/** Y rotation for each cardinal facing. */
const FACING_ROTATION = { north: 0, east: 90, south: 180, west: 270 }

function facingPermutations(extra = {}) {
    return Object.entries(FACING_ROTATION).map(([facing, y]) => ({
        condition: `q.block_state('minecraft:cardinal_direction') == '${facing}'`,
        components: { 'minecraft:transformation': { rotation: [0, y, 0] }, ...extra }
    }))
}

/** A block whose texture varies with a state. The state name must match what
 * the block declares, or Bedrock refuses to load it. */
function materialPermutations(prefix, materials, state = 'cb:material') {
    return materials.map((material) => ({
        condition: `q.block_state('${state}') == '${material}'`,
        components: {
            'minecraft:material_instances': {
                '*': {
                    texture: `${prefix}_${material}`,
                    render_method: prefix === 'cb_window' ? 'blend' : 'opaque'
                }
            }
        }
    }))
}

/**
 * A block whose body varies with a state but which also carries glazing on the
 * faces the geometry marked `glass`. Every permutation has to restate the whole
 * material_instances map — Bedrock replaces it wholesale rather than merging —
 * so dropping `glass` here silently turns the window back into siding.
 */
function glazedPermutations(prefix, tones, state) {
    return tones.map((tone) => ({
        condition: `q.block_state('${state}') == '${tone}'`,
        components: {
            'minecraft:material_instances': {
                '*': { texture: `${prefix}_${tone}`, render_method: 'opaque' },
                glass: { texture: 'cb_window_dark', render_method: 'blend' }
            }
        }
    }))
}

const TRIM_LIST = Object.keys(TRIM_TONES)
const STONE_LIST = Object.keys(STONE_TONES)

const SPEC = [
    {
        id: 'roof_slope',
        name: 'Roof Shingles (Slope)',
        geometry: 'geometry.cb_roof_slope',
        texture: 'cb_shingle_slate',
        states: { 'cb:material': Object.keys(SHINGLE_COLORS) },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_shingle', Object.keys(SHINGLE_COLORS)), ...facingPermutations()],
        // Full box so a player walks on the roof rather than through it.
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'roof_ridge',
        name: 'Roof Ridge Cap',
        geometry: 'geometry.cb_roof_ridge',
        texture: 'cb_ridge_slate',
        states: { 'cb:material': Object.keys(SHINGLE_COLORS) },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_ridge', Object.keys(SHINGLE_COLORS)), ...facingPermutations()],
        collision: { origin: [-8, 8, -8], size: [16, 8, 16] },
        category: 'construction'
    },
    {
        id: 'roof_hip',
        name: 'Roof Hip',
        geometry: 'geometry.cb_roof_hip',
        texture: 'cb_shingle_slate',
        states: { 'cb:material': Object.keys(SHINGLE_COLORS) },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_shingle', Object.keys(SHINGLE_COLORS)), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },

    {
        id: 'roof_fascia',
        name: 'Eaves Fascia',
        geometry: 'geometry.cb_roof_fascia',
        texture: 'cb_trim_white',
        states: { 'cb:tone': TRIM_LIST },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_trim', TRIM_LIST, 'cb:tone'), ...facingPermutations()],
        collision: 'none',
        category: 'construction'
    },
    {
        id: 'dormer',
        name: 'Dormer Window',
        geometry: 'geometry.cb_dormer',
        texture: 'cb_trim_white',
        glass: true,
        states: { 'cb:tone': TRIM_LIST },
        traits: CARDINAL_TRAIT,
        permutations: [...glazedPermutations('cb_trim', TRIM_LIST, 'cb:tone'), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'bay_window',
        name: 'Bay Window',
        geometry: 'geometry.cb_bay_window',
        texture: 'cb_trim_white',
        glass: true,
        states: { 'cb:tone': TRIM_LIST },
        traits: CARDINAL_TRAIT,
        permutations: [...glazedPermutations('cb_trim', TRIM_LIST, 'cb:tone'), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'cornice',
        name: 'Cornice',
        geometry: 'geometry.cb_cornice',
        texture: 'cb_stone_limestone',
        states: { 'cb:stone': STONE_LIST },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_stone', STONE_LIST, 'cb:stone'), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'stoop',
        name: 'Stoop',
        geometry: 'geometry.cb_stoop',
        texture: 'cb_stone_brownstone',
        states: { 'cb:stone': STONE_LIST },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_stone', STONE_LIST, 'cb:stone'), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'porch_post',
        name: 'Porch Post',
        geometry: 'geometry.cb_porch_post',
        texture: 'cb_trim_white',
        states: { 'cb:tone': TRIM_LIST },
        permutations: materialPermutations('cb_trim', TRIM_LIST, 'cb:tone'),
        collision: { origin: [-4, 0, -4], size: [8, 16, 8] },
        category: 'construction'
    },

    {
        id: 'window',
        name: 'Window',
        geometry: 'geometry.cb_window',
        texture: 'cb_window_dark',
        render: 'blend',
        states: { 'cb:style': Object.keys(WINDOW_STYLES) },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_window', Object.keys(WINDOW_STYLES), 'cb:style'), ...facingPermutations()],
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'construction'
    },
    {
        id: 'sconce',
        name: 'Wall Sconce',
        geometry: 'geometry.cb_sconce',
        texture: 'cb_brass',
        traits: CARDINAL_TRAIT,
        permutations: facingPermutations(),
        light: 13,
        collision: 'none',
        category: 'items'
    },
    {
        id: 'chandelier',
        name: 'Chandelier',
        geometry: 'geometry.cb_chandelier',
        texture: 'cb_brass',
        light: 14,
        collision: 'none',
        category: 'items'
    },
    {
        id: 'ceiling_light',
        name: 'Ceiling Light',
        geometry: 'geometry.cb_ceiling_light',
        texture: 'cb_glow_cool',
        light: 15,
        collision: 'none',
        category: 'items'
    },
    {
        id: 'pendant_light',
        name: 'Pendant Light',
        geometry: 'geometry.cb_pendant',
        texture: 'cb_glow_warm',
        light: 13,
        collision: 'none',
        category: 'items'
    },

    {
        id: 'wall_art',
        name: 'Framed Artwork',
        geometry: 'geometry.cb_wall_art',
        texture: 'cb_art_0',
        states: { 'cb:art': [0, 1, 2, 3, 4] },
        traits: CARDINAL_TRAIT,
        permutations: [
            ...[0, 1, 2, 3, 4].map((variant) => ({
                condition: `q.block_state('cb:art') == ${variant}`,
                components: {
                    'minecraft:material_instances': { '*': { texture: `cb_art_${variant}`, render_method: 'opaque' } }
                }
            })),
            ...facingPermutations()
        ],
        collision: 'none',
        category: 'items'
    },

    {
        id: 'sofa',
        name: 'Sofa',
        geometry: 'geometry.cb_sofa',
        texture: 'cb_fabric_charcoal',
        states: { 'cb:fabric': ['charcoal', 'olive', 'rust', 'cream'] },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_fabric', ['charcoal', 'olive', 'rust', 'cream'], 'cb:fabric'), ...facingPermutations()],
        collision: { origin: [-8, 0, -6], size: [16, 12, 12] },
        category: 'items'
    },
    {
        id: 'armchair',
        name: 'Armchair',
        geometry: 'geometry.cb_armchair',
        texture: 'cb_fabric_olive',
        states: { 'cb:fabric': ['charcoal', 'olive', 'rust', 'cream'] },
        traits: CARDINAL_TRAIT,
        permutations: [...materialPermutations('cb_fabric', ['charcoal', 'olive', 'rust', 'cream'], 'cb:fabric'), ...facingPermutations()],
        collision: { origin: [-6, 0, -5], size: [12, 12, 10] },
        category: 'items'
    },
    {
        id: 'desk',
        name: 'Desk',
        geometry: 'geometry.cb_desk',
        texture: 'cb_wood_walnut',
        traits: CARDINAL_TRAIT,
        permutations: facingPermutations(),
        collision: { origin: [-8, 0, -8], size: [16, 14, 16] },
        category: 'items'
    },
    {
        id: 'table',
        name: 'Table',
        geometry: 'geometry.cb_table',
        texture: 'cb_wood_oak',
        collision: { origin: [-8, 0, -8], size: [16, 14, 16] },
        category: 'items'
    },
    {
        id: 'counter',
        name: 'Counter',
        geometry: 'geometry.cb_counter',
        texture: 'cb_stone_worktop',
        traits: CARDINAL_TRAIT,
        permutations: facingPermutations(),
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'items'
    },
    {
        id: 'screen',
        name: 'Screen',
        geometry: 'geometry.cb_screen',
        texture: 'cb_screen_dark',
        traits: CARDINAL_TRAIT,
        permutations: facingPermutations(),
        collision: 'none',
        category: 'items'
    },
    {
        id: 'bookcase',
        name: 'Bookcase',
        geometry: 'geometry.cb_bookcase',
        texture: 'cb_wood_walnut',
        traits: CARDINAL_TRAIT,
        permutations: facingPermutations(),
        collision: { origin: [-8, 0, -8], size: [16, 16, 16] },
        category: 'items'
    },
    {
        id: 'planter',
        name: 'Planter',
        geometry: 'geometry.cb_planter',
        texture: 'cb_foliage',
        collision: { origin: [-5, 0, -5], size: [10, 14, 10] },
        category: 'items'
    }
]

// --- emit ------------------------------------------------------------------

mkdirSync(join(BP, 'blocks'), { recursive: true })
mkdirSync(join(RP, 'models', 'blocks'), { recursive: true })
mkdirSync(join(RP, 'textures', 'blocks'), { recursive: true })

const json = (value) => `${JSON.stringify(value, null, 4)}\n`

// Behaviour pack: one file per block.
for (const spec of SPEC) {
    const components = {
        'minecraft:geometry': spec.geometry,
        'minecraft:material_instances': {
            '*': { texture: spec.texture, render_method: spec.render ?? 'opaque' },
            // A geometry that names a `glass` instance must find one declared on
            // the base components too, not only inside the permutations.
            ...(spec.glass ? { glass: { texture: 'cb_window_dark', render_method: 'blend' } } : {})
        },
        'minecraft:destructible_by_mining': { seconds_to_destroy: 1.5 },
        'minecraft:destructible_by_explosion': { explosion_resistance: 3 }
    }
    if (spec.light) components['minecraft:light_emission'] = spec.light
    if (spec.collision === 'none') {
        components['minecraft:collision_box'] = false
        components['minecraft:selection_box'] = { origin: [-6, 0, -6], size: [12, 14, 12] }
    } else if (spec.collision) {
        components['minecraft:collision_box'] = spec.collision
        components['minecraft:selection_box'] = spec.collision
    }

    const description = { identifier: `cb:${spec.id}`, menu_category: { category: spec.category ?? 'items' } }
    if (spec.states) description.states = spec.states
    if (spec.traits) description.traits = spec.traits

    const block = { format_version: BLOCK_FORMAT, 'minecraft:block': { description, components } }
    if (spec.permutations?.length) block['minecraft:block'].permutations = spec.permutations

    writeFileSync(join(BP, 'blocks', `${spec.id}.json`), json(block))
}

// Resource pack: geometry.
for (const [identifier, geo] of Object.entries(GEOMETRIES)) {
    const file = identifier.replace('geometry.cb_', '')
    writeFileSync(
        join(RP, 'models', 'blocks', `${file}.geo.json`),
        json({ format_version: GEO_FORMAT, 'minecraft:geometry': [geo] })
    )
}

// Resource pack: textures.
for (const [name, tex] of Object.entries(TEXTURES)) {
    writeFileSync(join(RP, 'textures', 'blocks', `${name}.png`), tex.toPng())
}

// Resource pack: texture registry.
writeFileSync(
    join(RP, 'textures', 'terrain_texture.json'),
    json({
        resource_pack_name: 'city_builder',
        texture_name: 'atlas.terrain',
        padding: 8,
        num_mip_levels: 4,
        texture_data: Object.fromEntries(
            Object.keys(TEXTURES).map((name) => [name, { textures: `textures/blocks/${name}` }])
        )
    })
)

// Resource pack: sounds per block.
writeFileSync(
    join(RP, 'blocks.json'),
    json({
        format_version: [1, 1, 0],
        ...Object.fromEntries(
            SPEC.map((spec) => [
                `cb:${spec.id}`,
                {
                    sound:
                        /roof|cornice|stoop/.test(spec.id) ? 'stone'
                        : /sconce|chandelier|light|screen|window/.test(spec.id) ? 'glass'
                        : 'wood'
                }
            ])
        )
    })
)

// Lang entries for both packs.
const langLines = SPEC.map((spec) => `tile.cb:${spec.id}.name=${spec.name}`).join('\n')
for (const pack of [BP, RP]) {
    const path = join(pack, 'texts', 'en_US.lang')
    const existing = (await import('node:fs')).readFileSync(path, 'utf8')
    const cleaned = existing.replace(/\n# --- custom blocks ---[\s\S]*$/, '')
    writeFileSync(path, `${cleaned.trimEnd()}\n\n# --- custom blocks ---\n${langLines}\n`)
}

console.log(`generated ${SPEC.length} custom blocks`)
console.log(`  ${Object.keys(GEOMETRIES).length} geometries -> packs/city_builder_rp/models/blocks/`)
console.log(`  ${Object.keys(TEXTURES).length} textures   -> packs/city_builder_rp/textures/blocks/`)
console.log(`  block ids: ${SPEC.map((s) => `cb:${s.id}`).join(', ')}`)
