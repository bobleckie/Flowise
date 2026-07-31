#!/usr/bin/env node
/**
 * Generate buildings from the catalog: module JSON, `.mcstructure`, and an
 * isometric preview PNG.
 *
 *   node tools/build-preset.mjs monadnock_masonry_slab
 *   node tools/build-preset.mjs --all --preview
 *   node tools/build-preset.mjs --all --sheet        one contact sheet of everything
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import './lib/materials.mjs' // binds the material palette into the generator
import { loadCatalog } from './lib/catalog.mjs'
import { generateBuilding, totalHeight } from './lib/generate.mjs'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { renderIso, Canvas } from './lib/render.mjs'
import { parseArgs, fail, stringifyModule } from './lib/cli.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'dist', 'presets')

/** Bedrock structure blocks cap at 64x384x64; anything larger must be placed by script. */
const STRUCTURE_BLOCK_LIMIT = [64, 384, 64]

const USAGE = `usage: build-preset [<id> ...] [options]

      --all              every catalog entry
      --preview          also write an isometric PNG per building
      --sheet            write one contact sheet of all rendered buildings
      --shell-only       exterior skin only (much smaller; good for preview)
      --cutaway          remove the near quadrant so interiors are visible
      --no-structure     skip .mcstructure output (JSON + preview only)
      --out <dir>        output directory (default dist/presets)`

let args
try {
    args = parseArgs(process.argv.slice(2), {
        flags: ['all', 'preview', 'sheet', 'shell-only', 'no-structure', 'cutaway'],
        options: ['out']
    })
} catch (error) {
    fail(error.message, USAGE)
}

const catalog = loadCatalog()
let selected = args.all ? catalog : catalog.filter((e) => args._.includes(e.id))
// Tallest first, so a contact sheet reads as a skyline rather than a jumble.
if (args.sheet) selected = selected.slice().sort((a, b) => totalHeight(b) - totalHeight(a))
if (!selected.length) fail(args._.length ? `no catalog entry matched: ${args._.join(', ')}` : 'nothing selected', USAGE)

const outDir = args.out ?? OUT
mkdirSync(outDir, { recursive: true })

const oversize = []
const rendered = []
let totalBlocks = 0

for (const entry of selected) {
    let module
    try {
        module = generateBuilding(entry, { shellOnly: args['shell-only'] })
    } catch (error) {
        fail(`${entry.id}: ${error.message}`)
    }

    const [sx, sy, sz] = module.footprint
    totalBlocks += module.blocks.length

    if (sx > STRUCTURE_BLOCK_LIMIT[0] || sy > STRUCTURE_BLOCK_LIMIT[1] || sz > STRUCTURE_BLOCK_LIMIT[2]) {
        oversize.push({ id: entry.id, size: [sx, sy, sz] })
    }

    writeFileSync(join(outDir, `${entry.id}.module.json`), stringifyModule(module))

    if (!args['no-structure']) {
        writeFileSync(join(outDir, `${entry.id}.mcstructure`), writeMcStructure(moduleToModel(module)))
    }

    if (args.preview || args.sheet) {
        const canvas = renderIso(module.blocks, { maxPixels: args.sheet ? 260 : 1100, cutaway: args.cutaway })
        if (args.preview) writeFileSync(join(outDir, `${entry.id}.png`), canvas.toPng())
        rendered.push({ entry, canvas })
    }

    console.log(
        `${entry.id.padEnd(36)} ${String(sx).padStart(3)}x${String(sz).padStart(3)} ` +
            `x${String(sy).padStart(4)}h  ${String(module.blocks.length).padStart(7)} blocks`
    )
}

// --- contact sheet ---------------------------------------------------------

if (args.sheet && rendered.length) {
    const columns = Math.ceil(Math.sqrt(rendered.length * 1.6))
    const cellW = Math.max(...rendered.map((r) => r.canvas.width)) + 8
    const cellH = Math.max(...rendered.map((r) => r.canvas.height)) + 8
    const rows = Math.ceil(rendered.length / columns)

    const sheet = new Canvas(columns * cellW, rows * cellH, [18, 19, 24])
    rendered.forEach(({ canvas }, i) => {
        const col = i % columns
        const row = Math.floor(i / columns)
        // Bottom-align each cell so the skyline reads as a skyline.
        sheet.blit(canvas, col * cellW + Math.floor((cellW - canvas.width) / 2), row * cellH + (cellH - canvas.height) - 4)
    })

    const path = join(outDir, 'contact-sheet.png')
    writeFileSync(path, sheet.toPng())
    console.log(`\ncontact sheet: ${sheet.width}x${sheet.height} -> ${path}`)
}

// --- report ----------------------------------------------------------------

console.log(`\n${selected.length} building(s), ${totalBlocks.toLocaleString()} blocks total`)

if (oversize.length) {
    console.log(
        `\n${oversize.length} exceed the 64x384x64 structure-block limit and must be placed by script or tiled:`
    )
    for (const o of oversize) console.log(`  ${o.id.padEnd(36)} ${o.size.join('x')}`)
}
