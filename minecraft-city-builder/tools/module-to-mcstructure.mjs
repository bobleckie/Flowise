#!/usr/bin/env node
/**
 * Compile a module (intermediate format) into a Bedrock `.mcstructure`.
 *
 *   node tools/module-to-mcstructure.mjs fixtures/test_room.module.json \
 *        --style data/styles/brownstone.json -o out/test_room.mcstructure
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { moduleToModel } from './lib/module-format.mjs'
import { writeMcStructure } from './lib/mcstructure.mjs'
import { validateStyle, missingTokens, tokensUsed } from './lib/palette.mjs'
import { parseArgs, fail } from './lib/cli.mjs'

const USAGE = `usage: module-to-mcstructure <module.json> [options]

  -o, --out <path>          output path (default: alongside input, .mcstructure)
      --style <path>        style file binding $STYLE_* tokens
      --origin <x,y,z>      structure_world_origin (default 0,0,0)
      --enforce-dimensions  fail if the footprint violates SPEC.md §4.2
      --list-tokens         print the tokens this module uses, then exit`

let args
try {
    args = parseArgs(process.argv.slice(2), {
        flags: ['enforce-dimensions', 'list-tokens'],
        options: ['out', 'style', 'origin'],
        aliases: { o: 'out' }
    })
} catch (error) {
    fail(error.message, USAGE)
}

const input = args._[0]
if (!input) fail('no module file given', USAGE)

const module = JSON.parse(readFileSync(input, 'utf8'))

if (args['list-tokens']) {
    const tokens = [...tokensUsed(module)].sort()
    console.log(tokens.length ? tokens.join('\n') : '(module uses no palette tokens)')
    process.exit(0)
}

let style
if (args.style) {
    style = JSON.parse(readFileSync(args.style, 'utf8'))
    const styleErrors = validateStyle(style)
    if (styleErrors.length) fail(`style is invalid:\n  - ${styleErrors.join('\n  - ')}`)
}

const unbound = missingTokens(module, style)
if (unbound.length) {
    fail(
        `module "${module.id}" uses tokens the style does not bind:\n  - ${unbound.join('\n  - ')}\n` +
            (args.style ? '' : '\nPass --style to bind them.')
    )
}

const origin = args.origin ? args.origin.split(',').map((n) => Number.parseInt(n, 10)) : [0, 0, 0]
if (origin.length !== 3 || origin.some(Number.isNaN)) fail('--origin must be three integers, e.g. --origin 0,64,0')

let model
try {
    model = moduleToModel(module, { style, origin })
} catch (error) {
    fail(error.message)
}

const out = args.out ?? join(dirname(input), `${basename(input).replace(/\.(module\.)?json$/, '')}.mcstructure`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, writeMcStructure(model))

const placed = model.layers[0].reduce((n, index) => n + (index >= 0 ? 1 : 0), 0)
console.log(
    `${module.id}: ${placed} blocks, ${model.palette.length} palette entries, ` +
        `${model.blockEntities.size} block entities, ${model.entities.length} entities`
)
console.log(`wrote ${out}`)
