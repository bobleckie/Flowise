/**
 * Minecraft block colours and perceptual distance.
 *
 * The premortem's second-worst finding was that the catalog names 51 facade
 * materials Minecraft does not have, and that they might collapse into a dozen
 * indistinguishable looks. That is answerable rather than merely worrying: bind
 * every material to real blocks, then measure whether the results are actually
 * telling apart.
 *
 * Colours are average surface RGB, good enough for CIE76 deltaE comparison.
 * They drive the palette check and the preview renderer, never the game itself.
 */

export const BLOCK_COLORS = {
    // stone family
    'minecraft:stone': [125, 125, 125],
    'minecraft:smooth_stone': [159, 159, 159],
    'minecraft:stone_bricks': [122, 122, 122],
    'minecraft:chiseled_stone_bricks': [119, 119, 119],
    'minecraft:cobblestone': [127, 127, 127],
    'minecraft:andesite': [136, 136, 137],
    'minecraft:polished_andesite': [166, 166, 162],
    'minecraft:diorite': [188, 188, 189],
    'minecraft:polished_diorite': [232, 232, 233],
    'minecraft:granite': [149, 103, 85],
    'minecraft:polished_granite': [155, 106, 90],
    'minecraft:calcite': [223, 223, 213],
    'minecraft:tuff': [108, 110, 100],
    'minecraft:deepslate_tiles': [53, 53, 58],
    'minecraft:polished_deepslate': [75, 75, 78],
    'minecraft:deepslate_bricks': [61, 61, 65],
    'minecraft:blackstone': [43, 36, 38],
    'minecraft:polished_blackstone': [53, 48, 53],
    'minecraft:polished_blackstone_bricks': [48, 43, 48],
    'minecraft:basalt': [76, 76, 81],
    'minecraft:smooth_basalt': [72, 73, 79],

    // quartz / light stone
    'minecraft:quartz_block': [236, 230, 223],
    'minecraft:smooth_quartz': [236, 230, 223],
    'minecraft:quartz_bricks': [234, 228, 220],
    'minecraft:chiseled_quartz_block': [232, 226, 218],
    'minecraft:quartz_pillar': [235, 229, 222],
    'minecraft:bone_block': [225, 221, 200],
    'minecraft:end_stone_bricks': [221, 224, 165],

    // sandstone
    'minecraft:sandstone': [219, 211, 160],
    'minecraft:smooth_sandstone': [225, 214, 165],
    'minecraft:cut_sandstone': [217, 209, 158],
    'minecraft:chiseled_sandstone': [216, 208, 157],
    'minecraft:red_sandstone': [186, 99, 29],
    'minecraft:smooth_red_sandstone': [181, 97, 28],

    // brick + terracotta
    'minecraft:bricks': [150, 96, 75],
    'minecraft:terracotta': [155, 102, 80],
    'minecraft:white_terracotta': [210, 183, 160],
    'minecraft:orange_terracotta': [160, 83, 37],
    'minecraft:magenta_terracotta': [149, 88, 108],
    'minecraft:light_blue_terracotta': [113, 108, 137],
    'minecraft:yellow_terracotta': [186, 133, 35],
    'minecraft:lime_terracotta': [103, 117, 52],
    'minecraft:pink_terracotta': [161, 78, 78],
    'minecraft:gray_terracotta': [58, 44, 40],
    'minecraft:light_gray_terracotta': [135, 107, 98],
    'minecraft:cyan_terracotta': [87, 91, 91],
    'minecraft:purple_terracotta': [118, 70, 86],
    'minecraft:blue_terracotta': [74, 60, 91],
    'minecraft:brown_terracotta': [77, 50, 35],
    'minecraft:green_terracotta': [76, 83, 42],
    'minecraft:red_terracotta': [142, 60, 46],
    'minecraft:black_terracotta': [37, 22, 16],
    'minecraft:mud_bricks': [138, 106, 85],
    'minecraft:packed_mud': [142, 106, 79],
    'minecraft:nether_bricks': [45, 23, 27],

    // concrete
    'minecraft:white_concrete': [207, 213, 214],
    'minecraft:orange_concrete': [224, 97, 1],
    'minecraft:magenta_concrete': [169, 48, 159],
    'minecraft:light_blue_concrete': [36, 137, 199],
    'minecraft:yellow_concrete': [241, 175, 21],
    'minecraft:lime_concrete': [94, 169, 25],
    'minecraft:pink_concrete': [214, 101, 143],
    'minecraft:gray_concrete': [54, 57, 61],
    'minecraft:light_gray_concrete': [125, 125, 115],
    'minecraft:cyan_concrete': [21, 119, 136],
    'minecraft:purple_concrete': [100, 31, 156],
    'minecraft:blue_concrete': [44, 46, 143],
    'minecraft:brown_concrete': [96, 60, 32],
    'minecraft:green_concrete': [73, 91, 36],
    'minecraft:red_concrete': [142, 33, 33],
    'minecraft:black_concrete': [8, 10, 15],

    // metal
    'minecraft:iron_block': [216, 216, 216],
    'minecraft:gold_block': [249, 236, 78],
    'minecraft:copper_block': [192, 108, 80],
    'minecraft:exposed_copper': [161, 125, 103],
    'minecraft:weathered_copper': [108, 153, 126],
    'minecraft:oxidized_copper': [79, 150, 130],
    'minecraft:cut_copper': [191, 107, 79],
    'minecraft:waxed_copper_block': [192, 108, 80],

    // wood
    'minecraft:oak_planks': [176, 139, 80],
    'minecraft:dark_oak_planks': [74, 50, 24],
    'minecraft:spruce_planks': [107, 78, 48],
    'minecraft:birch_planks': [196, 179, 123],
    'minecraft:stripped_dark_oak_log': [96, 71, 41],
    'minecraft:stripped_spruce_log': [117, 91, 58],

    // glass — approximate tint; alpha handled by the renderer
    'minecraft:glass': [176, 220, 232],
    'minecraft:glass_pane': [176, 220, 232],
    'minecraft:tinted_glass': [44, 41, 46],
    'minecraft:white_stained_glass': [255, 255, 255],
    'minecraft:gray_stained_glass': [76, 76, 76],
    'minecraft:light_gray_stained_glass': [153, 153, 153],
    'minecraft:black_stained_glass': [25, 25, 25],
    'minecraft:brown_stained_glass': [102, 76, 51],
    'minecraft:blue_stained_glass': [51, 76, 178],
    'minecraft:light_blue_stained_glass': [102, 153, 216],
    'minecraft:cyan_stained_glass': [76, 127, 153],
    'minecraft:green_stained_glass': [102, 127, 51],
    'minecraft:lime_stained_glass': [127, 204, 25],
    'minecraft:orange_stained_glass': [216, 127, 51],
    'minecraft:yellow_stained_glass': [229, 229, 51],

    // light sources and fittings
    'minecraft:glowstone': [225, 200, 120],
    'minecraft:lantern': [220, 160, 80],
    'minecraft:sea_lantern': [190, 210, 200],
    'minecraft:shroomlight': [230, 140, 70],
    'minecraft:redstone_lamp': [95, 58, 33],
    'minecraft:torch': [230, 180, 90],
    'minecraft:ladder': [140, 110, 65],
    'minecraft:scaffolding': [180, 145, 85],

    // furniture
    'minecraft:bed': [165, 42, 42],
    'minecraft:bookshelf': [110, 86, 53],
    'minecraft:chest': [141, 105, 54],
    'minecraft:barrel': [111, 83, 47],
    'minecraft:lectern': [154, 121, 71],
    'minecraft:cauldron': [60, 60, 62],
    'minecraft:blast_furnace': [79, 79, 82],
    'minecraft:flower_pot': [124, 73, 56],
    'minecraft:red_wool': [160, 39, 34],
    'minecraft:red_carpet': [160, 39, 34],
    'minecraft:white_wool': [233, 236, 236],

    // custom blocks — see tools/gen-blocks.mjs
    'cb:roof_slope': [72, 78, 88],
    'cb:roof_ridge': [64, 70, 80],
    'cb:roof_hip': [72, 78, 88],
    'cb:sconce': [176, 138, 66],
    'cb:chandelier': [176, 138, 66],
    'cb:ceiling_light': [232, 244, 255],
    'cb:pendant_light': [255, 236, 190],
    'cb:wall_art': [92, 68, 44],
    'cb:window': [150, 190, 208],
    'cb:sofa': [64, 66, 72],
    'cb:armchair': [96, 100, 66],
    'cb:desk': [86, 60, 40],
    'cb:table': [162, 130, 84],
    'cb:counter': [186, 186, 182],
    'cb:screen': [22, 24, 30],
    'cb:bookcase': [86, 60, 40],
    'cb:planter': [72, 108, 56],
    'cb:roof_fascia': [226, 224, 216],
    'cb:dormer': [226, 224, 216],
    'cb:bay_window': [226, 224, 216],
    'cb:cornice': [206, 198, 178],
    'cb:stoop': [130, 88, 62],
    'cb:porch_post': [226, 224, 216],

    // street kit
    'cb:asphalt': [46, 47, 50],
    'cb:road_line': [46, 47, 50],
    'cb:paving': [166, 164, 158],
    'cb:curb': [150, 148, 144],
    'cb:manhole': [64, 62, 60],
    'cb:street_light': [118, 120, 122],
    'cb:light_pole': [118, 120, 122],
    'cb:traffic_signal': [38, 40, 44],
    'cb:hydrant': [162, 44, 38],
    'cb:bollard': [38, 40, 44],
    'cb:parking_meter': [118, 120, 122],
    'cb:street_sign': [42, 72, 54],
    'cb:bench': [162, 130, 84],
    'cb:trash_can': [42, 72, 54],
    'cb:shelter_glass': [176, 178, 180],

    // ground and planting
    'minecraft:gravel': [131, 127, 126],
    'minecraft:dirt': [134, 96, 67],
    'minecraft:grass_block': [92, 133, 62],
    'minecraft:oak_log': [109, 85, 51],
    'minecraft:oak_leaves': [62, 112, 44],

    // misc
    'minecraft:prismarine': [99, 156, 151],
    'minecraft:dark_prismarine': [51, 91, 75],
    'minecraft:purpur_block': [169, 125, 169],
    'minecraft:air': [0, 0, 0]
}

/** Blocks the renderer should draw as translucent. */
export const TRANSLUCENT = new Set(
    Object.keys(BLOCK_COLORS).filter((id) => id.includes('glass'))
)

/**
 * Shape variants (stairs, slabs, walls, doors, panes) take the colour of the
 * block they are cut from, so the table only has to list base materials.
 */
const VARIANT = /^(minecraft:.+?)_(stairs|slab|double_slab|wall|fence|fence_gate|pane|button|pressure_plate|trapdoor|door)$/

function deriveBase(blockId) {
    const match = blockId.match(VARIANT)
    if (!match) return null
    const stem = match[1]
    const candidates = [
        stem,
        `${stem}s`,
        stem.replace(/_brick$/, '_bricks'),
        `${stem}_block`,
        `${stem}_planks`,
        stem.replace(/^minecraft:/, 'minecraft:') + '_bricks'
    ]
    return candidates.find((c) => c in BLOCK_COLORS) ?? null
}

/**
 * Custom blocks whose colour comes from a block state rather than the id.
 * Without this the preview drew every roof slate-grey regardless of material.
 */
/** Painted joinery and cut stone, shared by several custom blocks. */
const TRIM_COLORS = {
    white: [226, 224, 216],
    cream: [214, 200, 172],
    grey: [128, 132, 138],
    wood: [118, 88, 58]
}
const PAVING_COLORS = {
    concrete: [166, 164, 158],
    granite: [138, 136, 134],
    bluestone: [116, 122, 126],
    brick: [146, 92, 72]
}
const PAINT_COLORS = {
    black: [38, 40, 44],
    green: [42, 72, 54],
    grey: [118, 120, 122],
    silver: [176, 178, 180]
}
const STONE_COLORS = {
    limestone: [206, 198, 178],
    granite: [126, 126, 128],
    brownstone: [130, 88, 62],
    terracotta: [176, 118, 86],
    concrete: [170, 168, 162]
}

const STATE_COLORS = {
    'cb:roof_slope': ['cb:material', { slate: [72, 78, 88], clay: [150, 78, 54], shake: [96, 72, 46], asphalt: [54, 54, 58], barrel: [172, 96, 58] }],
    'cb:roof_hip': ['cb:material', { slate: [72, 78, 88], clay: [150, 78, 54], shake: [96, 72, 46], asphalt: [54, 54, 58], barrel: [172, 96, 58] }],
    'cb:roof_ridge': ['cb:material', { slate: [84, 90, 100], clay: [166, 90, 64], shake: [110, 84, 56], asphalt: [66, 66, 70], barrel: [188, 110, 70] }],
    'cb:window': ['cb:style', { dark: [150, 190, 208], light: [190, 210, 220], bronze: [140, 152, 130], black: [96, 118, 134] }],
    'cb:sofa': ['cb:fabric', { charcoal: [64, 66, 72], olive: [96, 100, 66], rust: [140, 74, 52], cream: [196, 184, 158] }],
    'cb:armchair': ['cb:fabric', { charcoal: [64, 66, 72], olive: [96, 100, 66], rust: [140, 74, 52], cream: [196, 184, 158] }],
    'cb:roof_fascia': ['cb:tone', TRIM_COLORS],
    'cb:dormer': ['cb:tone', TRIM_COLORS],
    'cb:bay_window': ['cb:tone', TRIM_COLORS],
    'cb:porch_post': ['cb:tone', TRIM_COLORS],
    'cb:cornice': ['cb:stone', STONE_COLORS],
    'cb:stoop': ['cb:stone', STONE_COLORS],
    'cb:paving': ['cb:paving', PAVING_COLORS],
    'cb:curb': ['cb:paving', PAVING_COLORS],
    // Markings are what make a road read as a road from above, so the preview
    // has to show them rather than a uniform sheet of asphalt.
    'cb:road_line': ['cb:marking', {
        plain: [46, 47, 50],
        center: [186, 154, 54],
        double: [186, 154, 54],
        dash: [150, 150, 144],
        edge: [150, 150, 144],
        stop: [206, 206, 198],
        crossing: [216, 216, 208],
        arrow: [196, 196, 190]
    }],
    'cb:street_light': ['cb:tone', PAINT_COLORS],
    'cb:light_pole': ['cb:tone', PAINT_COLORS],
    'cb:bollard': ['cb:tone', PAINT_COLORS]
}

/** Colour for a placed block, taking its state into account. */
export function colorOfPlaced(block) {
    const rule = STATE_COLORS[block.block]
    if (rule) {
        const [state, table] = rule
        const value = block.state?.[state]
        if (value !== undefined && table[value]) return table[value]
    }
    return colorOf(block.block)
}

export function colorOf(blockId) {
    const direct = BLOCK_COLORS[blockId]
    if (direct) return direct
    const base = deriveBase(blockId)
    if (base) return BLOCK_COLORS[base]
    return [255, 0, 255] // magenta = unmapped, so it is obvious on sight
}

/** True when the block has a colour, directly or through its base material. */
export function isKnownBlock(blockId) {
    return blockId in BLOCK_COLORS || deriveBase(blockId) !== null
}

// --- perceptual distance ---------------------------------------------------

function srgbToLinear(c) {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB -> CIELAB (D65). */
export function rgbToLab([r, g, b]) {
    const R = srgbToLinear(r)
    const G = srgbToLinear(g)
    const B = srgbToLinear(b)

    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
    let y = R * 0.2126 + G * 0.7152 + B * 0.0722
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883

    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    x = f(x)
    y = f(y)
    z = f(z)

    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/**
 * CIE76 deltaE. Rough guide: <2.3 is imperceptible to most viewers, <10 reads
 * as "the same colour, slightly different", >20 is clearly a different material.
 */
export function deltaE(rgbA, rgbB) {
    const a = rgbToLab(rgbA)
    const b = rgbToLab(rgbB)
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Distance threshold below which two facade materials read as the same. */
export const SAME_MATERIAL_THRESHOLD = 12
