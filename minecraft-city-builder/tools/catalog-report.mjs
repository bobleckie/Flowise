#!/usr/bin/env node
/**
 * Validate the building catalog and print it categorized.
 *
 *   node tools/catalog-report.mjs                 summary by class and type
 *   node tools/catalog-report.mjs --envelope      Bedrock height feasibility
 *   node tools/catalog-report.mjs --city Chicago  filter to one city
 *   node tools/catalog-report.mjs --gaps          what the catalog is missing
 *   node tools/catalog-report.mjs --fitouts       every fitout the M6 engine owes
 */

import { loadCatalog, validateCatalog, heightClassOf, HEIGHT_CLASSES, TYPES, heightAboveGrade, depthBelowGrade } from './lib/catalog.mjs'
import { solveEnvelope, maxFloors, WORLD_HEIGHT } from './lib/envelope.mjs'
import { parseArgs, fail } from './lib/cli.mjs'

const USAGE = `usage: catalog-report [--envelope] [--city <name>] [--gaps] [--fitouts] [--quiet]`

let args
try {
    args = parseArgs(process.argv.slice(2), { flags: ['envelope', 'gaps', 'fitouts', 'quiet'], options: ['city'] })
} catch (error) {
    fail(error.message, USAGE)
}

let entries = loadCatalog()
const errors = validateCatalog(entries)
if (errors.length) {
    console.error(`Catalog validation failed (${errors.length}):`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
}

if (args.city) {
    entries = entries.filter((e) => (e.provenance.city ?? '').toLowerCase() === args.city.toLowerCase())
    if (!entries.length) fail(`no buildings for city "${args.city}"`)
}

const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

console.log(`Building catalog — ${entries.length} entries${args.city ? ` (${args.city})` : ''}\n`)

// --- by height class -------------------------------------------------------

if (!args.gaps && !args.fitouts) {
    console.log('BY HEIGHT CLASS')
    for (const cls of HEIGHT_CLASSES) {
        const group = entries.filter((e) => heightClassOf(e.massing.floors) === cls.id)
        if (!group.length) continue
        console.log(`\n  ${cls.label} — ${group.length}`)
        for (const entry of group.sort((a, b) => b.massing.floors - a.massing.floors)) {
            const h = heightAboveGrade(entry)
            const fp = entry.massing.footprint.join('x')
            const compressed = entry.massing.floors_actual ? ` (of ${entry.massing.floors_actual})` : ''
            console.log(
                `    ${pad(entry.id, 34)} ${num(entry.massing.floors, 3)}f${pad(compressed, 9)} ` +
                    `${pad(fp, 9)} ${num(h.total, 4)}b  ${entry.type}`
            )
        }
    }

    console.log('\n\nBY TYPE')
    for (const type of TYPES) {
        const group = entries.filter((e) => e.type === type)
        if (!group.length) continue
        console.log(`  ${pad(type, 16)} ${num(group.length, 3)}   ${group.map((e) => e.id).join(', ')}`)
    }

    console.log('\n\nBY TIER / DISTRIBUTION')
    for (const tier of ['composed', 'monolithic']) {
        console.log(`  ${pad(tier, 12)} ${entries.filter((e) => e.tier === tier).length}`)
    }
    for (const dist of ['unrestricted', 'review', 'personal_only']) {
        const group = entries.filter((e) => e.provenance.distribution === dist)
        console.log(`  ${pad(dist, 14)} ${num(group.length, 3)}`)
    }
}

// --- envelope --------------------------------------------------------------

if (args.envelope) {
    const solved = solveEnvelope(entries)
    console.log('\n\nBEDROCK VERTICAL ENVELOPE')
    console.log(`  world range           Y ${solved.world.min}..${solved.world.max} (${WORLD_HEIGHT} blocks, FIXED — add-ons cannot extend it)`)
    console.log(`  subsurface reserved   ${solved.below} blocks  ${JSON.stringify(solved.subsurface)}`)
    console.log(`  deepest basement      ${solved.deepest_basement} blocks`)
    console.log(`  street datum          Y ${solved.datum}`)
    console.log(`  headroom above street ${solved.headroom} blocks`)
    console.log(`\n  max floors that fit:`)
    for (const fh of [3, 4, 5]) {
        console.log(`    at ${fh} blocks/floor   ${num(maxFloors(solved.headroom, fh), 4)}  (${num(maxFloors(solved.headroom, fh, 8, 40), 4)} with a 40-block antenna)`)
    }

    console.log(`\n  tallest five:`)
    for (const b of solved.buildings.slice(0, 5)) {
        console.log(
            `    ${pad(b.id, 34)} ${num(b.floors, 3)}f x ${b.floor_height}  shaft ${num(b.shaft, 4)} ` +
                `+ roof ${num(b.roofcap, 2)} + ant ${num(b.antenna, 3)} = ${num(b.total, 4)}  ${b.fits ? 'fits' : `OVER by ${b.deficit}`}`
        )
    }

    if (solved.feasible) {
        console.log(`\n  RESULT: all ${entries.length} buildings fit. Headroom to spare: ${solved.headroom - solved.tallest.total} blocks.`)
    } else {
        console.log(`\n  RESULT: ${solved.failures.length} building(s) DO NOT FIT:`)
        for (const b of solved.failures) console.log(`    ${b.id} over by ${b.deficit} blocks`)
    }
}

// --- coverage gaps ---------------------------------------------------------

if (args.gaps) {
    console.log('COVERAGE')
    const byClass = Object.fromEntries(HEIGHT_CLASSES.map((c) => [c.id, 0]))
    for (const entry of entries) byClass[heightClassOf(entry.massing.floors)]++

    console.log('\n  height classes (target: 6+ each)')
    for (const cls of HEIGHT_CLASSES) {
        const n = byClass[cls.id]
        console.log(`    ${pad(cls.label, 28)} ${num(n, 3)}  ${n >= 6 ? 'ok' : `SHORT by ${6 - n}`}`)
    }

    console.log('\n  types with no entry')
    const missing = TYPES.filter((t) => !entries.some((e) => e.type === t))
    console.log(missing.length ? `    ${missing.join(', ')}` : '    none')

    console.log('\n  footprint range')
    const areas = entries.map((e) => e.massing.footprint[0] * e.massing.footprint[1]).sort((a, b) => a - b)
    console.log(`    smallest ${areas[0]} blocks^2, largest ${areas[areas.length - 1]} blocks^2`)

    console.log('\n  below-grade')
    const noBasement = entries.filter((e) => !depthBelowGrade(e))
    console.log(`    ${entries.length - noBasement.length} of ${entries.length} have below-grade levels`)
    const transit = entries.filter((e) => e.below_grade?.transit && e.below_grade.transit !== 'none')
    console.log(`    ${transit.length} connect to transit: ${transit.map((e) => e.id).join(', ')}`)
}

// --- fitout obligations ----------------------------------------------------

if (args.fitouts) {
    const fitouts = new Map()
    for (const entry of entries) {
        for (const [room, fitout] of Object.entries(entry.fitout ?? {})) {
            if (!fitouts.has(fitout)) fitouts.set(fitout, { room, users: [] })
            fitouts.get(fitout).users.push(entry.id)
        }
    }
    console.log(`FITOUTS THE M6 ENGINE MUST PROVIDE — ${fitouts.size} distinct\n`)
    for (const [fitout, info] of [...fitouts.entries()].sort((a, b) => b[1].users.length - a[1].users.length)) {
        console.log(`  ${pad(fitout, 32)} ${pad(info.room, 20)} used by ${info.users.length}`)
    }
    console.log(`\n  Each is a room-dressing rule, not a hand-built room. ${fitouts.size} rules cover ${entries.length} buildings.`)
}
