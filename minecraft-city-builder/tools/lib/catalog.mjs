/**
 * Building catalog: schema, validation, and derived metrics (SPEC.md M8).
 *
 * The catalog is the specification the assembler is built to. Every attribute
 * the assembler needs to produce a complete building lives here — massing,
 * structure, facade rhythm, vertical transport, below-grade, roofscape, and
 * which fitout dresses each floor band. If it is not in the catalog, the
 * assembler has no way to know about it and the building comes out generic.
 *
 * Heights are the load-bearing constraint. Bedrock's build range is fixed at
 * Y -64..319 (384 blocks) and add-ons cannot extend it, so a tall building's
 * feasibility is arithmetic, not opinion. See `envelope.mjs`.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const CATALOG_DIR = join(ROOT, 'data', 'catalog')

// --- vocabulary ------------------------------------------------------------

/** Height classes, by rendered floor count. Order matters: first match wins. */
export const HEIGHT_CLASSES = [
    { id: 'supertall', min: 60, label: 'Supertall (60+ floors)' },
    { id: 'highrise', min: 20, label: 'High-rise (20-59)' },
    { id: 'midrise', min: 7, label: 'Mid-rise (7-19)' },
    { id: 'lowrise', min: 3, label: 'Low-rise (3-6)' },
    { id: 'single_story', min: 1, label: 'One to two storeys' }
]

export const TYPES = [
    'office', 'residential', 'mixed_use', 'hotel', 'retail', 'restaurant',
    'automotive', 'industrial', 'civic', 'institutional', 'transit',
    'religious', 'entertainment', 'parking', 'healthcare', 'education'
]

export const TIERS = ['composed', 'monolithic']

export const ROOF_TYPES = [
    'flat_mechanical', 'flat_parapet', 'setback_crown', 'pyramid', 'spire',
    'gothic_crown', 'dome', 'gable', 'hip', 'mansard', 'sawtooth', 'barrel_vault',
    'canopy', 'flytower'
]

export const DISTRIBUTION = ['unrestricted', 'review', 'personal_only']

/** Room types the fitout engine (M6) must know how to dress. */
export const ROOM_TYPES = [
    'lobby', 'office_open', 'office_private', 'corridor', 'restroom', 'stair',
    'elevator_lobby', 'mechanical', 'retail_floor', 'restaurant_dining',
    'restaurant_kitchen', 'hotel_room', 'apartment', 'bedroom', 'kitchen',
    'living', 'bathroom', 'classroom', 'library_stack', 'ward', 'exam',
    'sanctuary', 'auditorium', 'gallery', 'workshop', 'storage', 'loading_dock',
    'parking_deck', 'transit_mezzanine', 'transit_platform', 'basement',
    'penthouse', 'sky_lobby', 'garage_bay', 'apparatus_bay', 'cell_block'
]

// --- validation ------------------------------------------------------------

const isInt = (v) => Number.isInteger(v)
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isInt) && v.every((n) => n > 0)

export function heightClassOf(floors) {
    return HEIGHT_CLASSES.find((c) => floors >= c.min)?.id ?? 'single_story'
}

export function validateEntry(entry, { seenIds = new Set() } = {}) {
    const errors = []
    const at = entry?.id ? `${entry.id}` : '<no id>'
    const err = (message) => errors.push(`${at}: ${message}`)

    if (!entry || typeof entry !== 'object') return ['entry must be an object']
    if (typeof entry.id !== 'string' || !/^[a-z0-9_]+$/.test(entry.id)) err('id must be lower_snake_case')
    else if (seenIds.has(entry.id)) err('duplicate id')
    if (typeof entry.name !== 'string' || !entry.name) err('missing name')
    if (!TYPES.includes(entry.type)) err(`type "${entry.type}" is not a known type`)
    if (!TIERS.includes(entry.tier)) err(`tier "${entry.tier}" must be one of ${TIERS.join(', ')}`)

    // --- provenance
    const p = entry.provenance
    if (!p || typeof p !== 'object') err('missing provenance')
    else {
        if (!p.inspiration) err('provenance.inspiration is required — say what this is modelled on')
        if (!DISTRIBUTION.includes(p.distribution)) err(`provenance.distribution "${p.distribution}" is invalid`)
        if (p.completed !== undefined && !isInt(p.completed)) err('provenance.completed must be a year')
        if (p.completed !== undefined && p.pre1990 !== undefined && p.pre1990 !== p.completed < 1990) {
            err(`provenance.pre1990 (${p.pre1990}) contradicts completed (${p.completed})`)
        }
        // A named post-1990 landmark cannot be marked freely distributable.
        if (p.named_landmark && p.completed >= 1990 && p.distribution === 'unrestricted') {
            err('a named post-1990 landmark cannot be distribution "unrestricted"')
        }
    }

    // --- massing
    const m = entry.massing
    if (!m || typeof m !== 'object') {
        err('missing massing')
        return errors
    }
    if (!isPair(m.footprint)) err('massing.footprint must be [x, z] positive integers')
    if (!isInt(m.floors) || m.floors < 1) err('massing.floors must be a positive integer')

    // Composed buildings stack on the module grid, so their floor height must be
    // one the grid supports. Monolithic buildings are authored whole and can be
    // any plausible height — a church nave really is 20 blocks.
    if (entry.tier === 'composed') {
        if (![3, 4, 5, 6, 8].includes(m.floor_height)) {
            err(`massing.floor_height ${m.floor_height} must be 3, 4, 5, 6 or 8 for a composed building (module grid)`)
        }
    } else if (!isInt(m.floor_height) || m.floor_height < 3 || m.floor_height > 24) {
        err(`massing.floor_height ${m.floor_height} must be between 3 and 24`)
    }
    if (m.ground_floor_height !== undefined && (!isInt(m.ground_floor_height) || m.ground_floor_height < m.floor_height)) {
        err('massing.ground_floor_height must be at least floor_height')
    }

    // floors_actual records the real building when we render fewer, so the
    // compression is explicit rather than a silent lie.
    if (m.floors_actual !== undefined) {
        if (!isInt(m.floors_actual)) err('massing.floors_actual must be an integer')
        else if (m.floors_actual < m.floors) err('massing.floors_actual must be >= rendered floors')
    }

    for (const [i, setback] of (m.setbacks ?? []).entries()) {
        if (!isInt(setback.at_floor) || setback.at_floor < 2 || setback.at_floor > m.floors) {
            err(`setbacks[${i}].at_floor ${setback.at_floor} is outside 2..${m.floors}`)
        }
        if (!isPair(setback.footprint)) err(`setbacks[${i}].footprint must be [x, z]`)
        else if (
            !m.inverted_profile &&
            (setback.footprint[0] > m.footprint[0] || setback.footprint[1] > m.footprint[1])
        ) {
            // Cantilevers are real, but they must be declared — otherwise this
            // catches the far more common case of a transposed footprint.
            err(`setbacks[${i}] is larger than the base footprint; set massing.inverted_profile if the overhang is intentional`)
        }
    }
    const setbackFloors = (m.setbacks ?? []).map((s) => s.at_floor)
    if (setbackFloors.some((f, i) => i > 0 && f <= setbackFloors[i - 1])) err('setbacks must be in ascending floor order')

    const roof = m.roof
    if (!roof || !ROOF_TYPES.includes(roof.type)) err(`massing.roof.type "${roof?.type}" is not a known roof type`)
    for (const [i, antenna] of (roof?.antennas ?? []).entries()) {
        if (!isInt(antenna.height) || antenna.height < 1) err(`roof.antennas[${i}].height must be a positive integer`)
    }

    // --- below grade
    const b = entry.below_grade
    if (b) {
        if (!isInt(b.levels) || b.levels < 0) err('below_grade.levels must be a non-negative integer')
        if (b.levels > 0 && !isInt(b.level_height)) err('below_grade.level_height is required when levels > 0')
        for (const use of b.uses ?? []) {
            if (!ROOM_TYPES.includes(use)) err(`below_grade use "${use}" is not a known room type`)
        }
    }

    // --- structure
    const s = entry.structure
    if (entry.tier === 'composed') {
        if (!s) err('composed buildings require a structure block')
        else {
            if (!isInt(s.bay) || s.bay < 1) err('structure.bay must be a positive integer')
            if (s.core && !isPair(s.core.footprint)) err('structure.core.footprint must be [x, z]')
            if (s.core?.footprint && m.footprint) {
                if (s.core.footprint[0] >= m.footprint[0] || s.core.footprint[1] >= m.footprint[1]) {
                    err('structure.core is not smaller than the building footprint')
                }
            }
        }
    }

    // --- vertical transport
    const v = entry.vertical
    if (!v) err('missing vertical (stairs and elevators)')
    else {
        if (!isInt(v.stairs) || v.stairs < 1) err('vertical.stairs must be at least 1 — every building needs a stair')
        const elevators = (v.passenger_elevators ?? 0) + (v.service_elevators ?? 0)
        // Anything tall enough to need one, needs one.
        if (m.floors >= 5 && elevators < 1) err(`${m.floors} floors with no elevator`)
        for (const floor of v.sky_lobbies ?? []) {
            if (!isInt(floor) || floor < 2 || floor > m.floors) err(`sky lobby on floor ${floor} is outside the building`)
        }
    }

    // --- facade
    const f = entry.facade
    if (!f) err('missing facade')
    else if (!f.system) err('facade.system is required')

    // --- program bands must tile the building exactly once
    const program = entry.program ?? []
    if (!program.length) err('missing program — every floor must be accounted for')
    else {
        const covered = new Array(m.floors + 1).fill(0)
        for (const [i, band] of program.entries()) {
            const range = band.floors
            if (!Array.isArray(range) || range.length !== 2 || !range.every(isInt)) {
                err(`program[${i}].floors must be [from, to]`)
                continue
            }
            const [from, to] = range
            if (from < 1 || to > m.floors || from > to) {
                err(`program[${i}] floors ${from}..${to} outside 1..${m.floors}`)
                continue
            }
            if (!ROOM_TYPES.includes(band.use)) err(`program[${i}].use "${band.use}" is not a known room type`)
            for (let n = from; n <= to; n++) covered[n]++
        }
        const uncovered = []
        const doubled = []
        for (let n = 1; n <= m.floors; n++) {
            if (covered[n] === 0) uncovered.push(n)
            else if (covered[n] > 1) doubled.push(n)
        }
        if (uncovered.length) err(`floors with no program: ${summarizeRuns(uncovered)}`)
        if (doubled.length) err(`floors covered by two program bands: ${summarizeRuns(doubled)}`)
    }

    return errors
}

/** "1,2,3,7" -> "1-3, 7" so long gaps read cleanly in error messages. */
function summarizeRuns(numbers) {
    const runs = []
    let start = numbers[0]
    let previous = numbers[0]
    for (const n of numbers.slice(1)) {
        if (n === previous + 1) previous = n
        else {
            runs.push(start === previous ? `${start}` : `${start}-${previous}`)
            start = previous = n
        }
    }
    runs.push(start === previous ? `${start}` : `${start}-${previous}`)
    return runs.join(', ')
}

// --- derived metrics -------------------------------------------------------

/** Pitched roofs rise half their span; see `pitchedRise` in generate.mjs. */
const PITCHED = new Set(['gable', 'hip', 'mansard'])

function roofCap(entry) {
    const m = entry.massing
    if (PITCHED.has(m.roof.type)) {
        // The topmost plate carries the roof, so its span sets the rise.
        const last = (m.setbacks ?? []).slice(-1)[0]?.footprint ?? m.footprint
        const span = m.roof.type === 'gable' ? last[0] : Math.min(last[0], last[1])
        const full = Math.max(2, Math.ceil(span / 2))
        return m.roof.height ? Math.max(2, Math.min(full, m.roof.height)) : full
    }
    return m.roof.height ?? (m.roof.type === 'flat_mechanical' ? 8 : 0)
}

/** Total block height above the street datum, including roof and antennas. */
export function heightAboveGrade(entry) {
    const m = entry.massing
    const ground = m.ground_floor_height ?? m.floor_height
    const shaft = ground + (m.floors - 1) * m.floor_height
    const roofcap = roofCap(entry)
    const antenna = Math.max(0, ...(m.roof.antennas ?? []).map((a) => a.height))
    return { shaft, roofcap, antenna, total: shaft + roofcap + antenna }
}

/** Block depth below the street datum. */
export function depthBelowGrade(entry) {
    const b = entry.below_grade
    if (!b || !b.levels) return 0
    return b.levels * (b.level_height ?? 4)
}

// --- loading ---------------------------------------------------------------

export function loadCatalog(dir = CATALOG_DIR) {
    const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    const entries = []
    for (const file of files) {
        const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
        const list = Array.isArray(parsed) ? parsed : parsed.buildings
        if (!Array.isArray(list)) throw new Error(`${file}: expected an array or a { buildings: [...] } object`)
        for (const entry of list) entries.push({ ...entry, source: file })
    }
    return entries
}

export function validateCatalog(entries) {
    const errors = []
    const seenIds = new Set()
    for (const entry of entries) {
        errors.push(...validateEntry(entry, { seenIds }))
        if (entry?.id) seenIds.add(entry.id)
    }
    return errors
}
