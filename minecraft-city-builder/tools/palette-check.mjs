#!/usr/bin/env node
/**
 * Answer the premortem's palette question with measurement instead of worry.
 *
 * Checks three things:
 *   1. Every catalog facade system has a binding, and every block in it exists.
 *   2. How many systems are actually distinguishable, by CIELAB distance on the
 *      wall material — the dominant visual signal at street scale.
 *   3. Where two systems collide on colour, whether some *other* signal
 *      (window pattern, cornice, trim) still separates them in practice.
 *
 * Point 3 is the important one. Colour is not the only channel, so a colour
 * collision is only a real collision if everything else matches too.
 *
 *   node tools/palette-check.mjs [--verbose]
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCatalog } from './lib/catalog.mjs'
import { colorOf, isKnownBlock, deltaE, SAME_MATERIAL_THRESHOLD } from './lib/blocks.mjs'
import { parseArgs, fail } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PALETTE = JSON.parse(readFileSync(join(ROOT, 'data', 'palettes', 'materials.json'), 'utf8'))

let args
try {
    args = parseArgs(process.argv.slice(2), { flags: ['verbose'], options: [] })
} catch (error) {
    fail(error.message)
}

const catalog = loadCatalog()
const systems = PALETTE.systems
const problems = []

// --- 1. coverage -----------------------------------------------------------

const used = [...new Set(catalog.map((e) => e.facade.system))].sort()
const unbound = used.filter((s) => !systems[s])
const unusedBindings = Object.keys(systems).filter((s) => !used.includes(s))

for (const s of unbound) problems.push(`facade system "${s}" has no palette binding`)

for (const [name, roles] of Object.entries(systems)) {
    for (const [role, block] of Object.entries(roles)) {
        if (!isKnownBlock(block)) problems.push(`${name}.${role} -> "${block}" is not a known block`)
    }
}

console.log(`PALETTE COVERAGE`)
console.log(`  catalog facade systems   ${used.length}`)
console.log(`  bound                    ${used.length - unbound.length}`)
console.log(`  unbound                  ${unbound.length}${unbound.length ? ` (${unbound.join(', ')})` : ''}`)
if (unusedBindings.length) console.log(`  bindings not used by any building: ${unusedBindings.join(', ')}`)

// --- 2. colour distinguishability -----------------------------------------

const bound = used.filter((s) => systems[s])
const wallColor = (s) => colorOf(systems[s].wall)

const collisions = []
for (let i = 0; i < bound.length; i++) {
    for (let j = i + 1; j < bound.length; j++) {
        const d = deltaE(wallColor(bound[i]), wallColor(bound[j]))
        if (d < SAME_MATERIAL_THRESHOLD) collisions.push({ a: bound[i], b: bound[j], d })
    }
}
collisions.sort((x, y) => x.d - y.d)

// Distinct colour groups: systems whose walls nobody can tell apart.
const groups = []
for (const s of bound) {
    const group = groups.find((g) => deltaE(wallColor(g[0]), wallColor(s)) < SAME_MATERIAL_THRESHOLD)
    if (group) group.push(s)
    else groups.push([s])
}

console.log(`\nWALL COLOUR SEPARATION  (CIELAB deltaE, threshold ${SAME_MATERIAL_THRESHOLD})`)
console.log(`  distinct wall colours    ${groups.length} of ${bound.length} systems`)
console.log(`  colliding pairs          ${collisions.length}`)

// --- 3. do other signals rescue the collisions? ---------------------------

/** Everything besides wall colour that separates two buildings visually. */
function signature(system) {
    const users = catalog.filter((e) => e.facade.system === system)
    return {
        windows: new Set(users.map((e) => e.facade.window_pattern)),
        cornices: new Set(users.map((e) => e.facade.cornice).filter(Boolean)),
        trim: systems[system].trim,
        accent: systems[system].accent,
        glass: systems[system].glass
    }
}

const realCollisions = []
for (const c of collisions) {
    const a = signature(c.a)
    const b = signature(c.b)

    const sharesWindow = [...a.windows].some((w) => b.windows.has(w))
    const trimApart = deltaE(colorOf(a.trim), colorOf(b.trim)) >= SAME_MATERIAL_THRESHOLD
    const accentApart = deltaE(colorOf(a.accent), colorOf(b.accent)) >= SAME_MATERIAL_THRESHOLD
    const glassApart = deltaE(colorOf(a.glass), colorOf(b.glass)) >= SAME_MATERIAL_THRESHOLD

    // A colour collision only matters when nothing else separates them.
    const rescued = !sharesWindow || trimApart || accentApart || glassApart
    const entry = { ...c, sharesWindow, trimApart, accentApart, glassApart, rescued }
    if (!rescued) realCollisions.push(entry)
    if (args.verbose) {
        console.log(
            `    ${c.a} / ${c.b}  dE=${c.d.toFixed(1)}  ` +
                `${rescued ? 'separated by' : 'NOT separated —'} ` +
                [trimApart && 'trim', accentApart && 'accent', glassApart && 'glass', !sharesWindow && 'window pattern']
                    .filter(Boolean)
                    .join(', ') || 'nothing'
        )
    }
}

console.log(`\nAFTER SECONDARY SIGNALS  (trim, accent, glazing, window pattern)`)
console.log(`  colour collisions rescued by another signal  ${collisions.length - realCollisions.length}`)
console.log(`  genuinely indistinguishable pairs            ${realCollisions.length}`)

if (realCollisions.length) {
    console.log(`\n  These need a real fix — nothing separates them:`)
    for (const c of realCollisions) console.log(`    ${c.a}  ==  ${c.b}   (dE ${c.d.toFixed(1)})`)
}

// --- verdict ---------------------------------------------------------------

const buildingsAffected = realCollisions.flatMap((c) =>
    catalog.filter((e) => e.facade.system === c.a || e.facade.system === c.b).map((e) => e.id)
)

console.log(`\nVERDICT`)
console.log(`  ${bound.length} facade systems bind to real blocks`)
console.log(`  ${groups.length} distinct wall colours`)
console.log(
    `  ${bound.length - realCollisions.length} of ${bound.length} systems are visually distinct once every signal is counted`
)
console.log(`  ${new Set(buildingsAffected).size} of ${catalog.length} buildings affected by a real collision`)

if (problems.length) {
    console.error(`\nPROBLEMS (${problems.length}):`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
}
