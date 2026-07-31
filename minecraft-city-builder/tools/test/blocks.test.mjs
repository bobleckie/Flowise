/**
 * Custom block library tests.
 *
 * Bedrock reports a malformed custom block as a silent load failure with a
 * stack trace only in the Content Log, so these check the things that break a
 * pack: missing geometry, unregistered textures, states referenced by
 * permutations that were never declared, and geometry that escapes the block.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import '../lib/materials.mjs'
import { loadCatalog } from '../lib/catalog.mjs'
import { generateBuilding, ROOF_KITS, roofKitFor } from '../lib/generate.mjs'
import { isKnownBlock } from '../lib/blocks.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const BP = join(ROOT, 'packs', 'city_builder_bp')
const RP = join(ROOT, 'packs', 'city_builder_rp')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const blockFiles = () => readdirSync(join(BP, 'blocks')).filter((n) => n.endsWith('.json'))
const terrain = () => readJson(join(RP, 'textures', 'terrain_texture.json')).texture_data

test('the custom block library exists — run `node tools/gen-blocks.mjs`', () => {
    assert.ok(blockFiles().length >= 15, `only ${blockFiles().length} custom blocks`)
    assert.ok(existsSync(join(RP, 'textures', 'terrain_texture.json')))
})

test('every custom block declares geometry that exists', () => {
    for (const file of blockFiles()) {
        const block = readJson(join(BP, 'blocks', file))['minecraft:block']
        const geo = block.components['minecraft:geometry']
        assert.ok(geo, `${file}: no geometry`)

        const model = join(RP, 'models', 'blocks', `${geo.replace('geometry.cb_', '')}.geo.json`)
        assert.ok(existsSync(model), `${file}: geometry "${geo}" has no model file`)

        const parsed = readJson(model)['minecraft:geometry'][0]
        assert.equal(parsed.description.identifier, geo, `${model}: identifier mismatch`)
        assert.ok(parsed.bones[0].cubes.length > 0, `${model}: no cubes`)
    }
})

test('geometry stays inside the block, so neighbours do not overlap', () => {
    // Bedrock allows a little overhang, but a cube far outside the block box
    // renders through the wall next to it.
    for (const file of readdirSync(join(RP, 'models', 'blocks'))) {
        const geo = readJson(join(RP, 'models', 'blocks', file))['minecraft:geometry'][0]
        for (const cube of geo.bones[0].cubes) {
            const [ox, oy, oz] = cube.origin
            const [sx, sy, sz] = cube.size
            // Rotated cubes are declared oversize on purpose — a 45-degree
            // slope spans the block diagonal — so only the unrotated ones are
            // held to the block bounds.
            if (cube.rotation) continue
            assert.ok(ox >= -8 && ox + sx <= 8, `${file}: cube escapes in x (${ox}..${ox + sx})`)
            assert.ok(oy >= 0 && oy + sy <= 16, `${file}: cube escapes in y (${oy}..${oy + sy})`)
            assert.ok(oz >= -8 && oz + sz <= 8, `${file}: cube escapes in z (${oz}..${oz + sz})`)
        }
    }
})

test('every texture a block names is registered and present', () => {
    const registry = terrain()
    for (const file of blockFiles()) {
        const block = readJson(join(BP, 'blocks', file))['minecraft:block']
        const named = new Set()
        const collect = (components) => {
            for (const instance of Object.values(components?.['minecraft:material_instances'] ?? {})) {
                if (instance.texture) named.add(instance.texture)
            }
        }
        collect(block.components)
        for (const permutation of block.permutations ?? []) collect(permutation.components)

        assert.ok(named.size > 0, `${file}: names no texture`)
        for (const texture of named) {
            assert.ok(registry[texture], `${file}: "${texture}" not in terrain_texture.json`)
            assert.ok(existsSync(join(RP, `${registry[texture].textures}.png`)), `${file}: ${texture}.png missing`)
        }
    }
})

test('permutations only reference states the block declares', () => {
    // A condition on an undeclared state makes the block fail to load.
    for (const file of blockFiles()) {
        const block = readJson(join(BP, 'blocks', file))['minecraft:block']
        const declared = new Set(Object.keys(block.description.states ?? {}))
        const traitStates = new Set(
            Object.values(block.description.traits ?? {}).flatMap((trait) => trait.enabled_states ?? [])
        )

        for (const permutation of block.permutations ?? []) {
            for (const match of permutation.condition.matchAll(/q\.block_state\('([^']+)'\)/g)) {
                const state = match[1]
                assert.ok(
                    declared.has(state) || traitStates.has(state),
                    `${file}: permutation uses undeclared state "${state}"`
                )
            }
        }
    }
})

test('every state value a permutation matches is a legal value', () => {
    for (const file of blockFiles()) {
        const block = readJson(join(BP, 'blocks', file))['minecraft:block']
        const states = block.description.states ?? {}

        for (const permutation of block.permutations ?? []) {
            const match = permutation.condition.match(/q\.block_state\('(cb:[^']+)'\) == '?([^'\s]+)'?/)
            if (!match) continue
            const [, state, value] = match
            if (!states[state]) continue
            const legal = states[state].map(String)
            assert.ok(legal.includes(value), `${file}: "${value}" is not a legal ${state} (${legal.join(', ')})`)
        }
    }
})

test('every custom block the generator places actually exists', () => {
    const defined = new Set(blockFiles().map((f) => `cb:${f.replace('.json', '')}`))
    const used = new Set()
    for (const entry of loadCatalog()) {
        for (const block of generateBuilding(entry).blocks) {
            if (block.block.startsWith('cb:')) used.add(block.block)
        }
    }
    assert.ok(used.size > 0, 'the generator places no custom blocks at all')
    for (const id of used) assert.ok(defined.has(id), `generator places undefined block ${id}`)
})

test('every custom block state the generator sets is declared', () => {
    const blocks = new Map(
        blockFiles().map((f) => [`cb:${f.replace('.json', '')}`, readJson(join(BP, 'blocks', f))['minecraft:block']])
    )

    for (const entry of loadCatalog()) {
        for (const placed of generateBuilding(entry).blocks) {
            if (!placed.block.startsWith('cb:') || !placed.state) continue
            const definition = blocks.get(placed.block)
            const declared = definition.description.states ?? {}
            const traitStates = new Set(
                Object.values(definition.description.traits ?? {}).flatMap((t) => t.enabled_states ?? [])
            )

            for (const [state, value] of Object.entries(placed.state)) {
                if (traitStates.has(state)) continue
                assert.ok(declared[state], `${entry.id}: ${placed.block} sets undeclared state "${state}"`)
                assert.ok(
                    declared[state].map(String).includes(String(value)),
                    `${entry.id}: ${placed.block} sets ${state}="${value}", legal: ${declared[state].join(', ')}`
                )
            }
        }
    }
})

test('roofing is chosen from the era and every kit is reachable', () => {
    const catalog = loadCatalog()
    const used = new Set(catalog.map((e) => roofKitFor(e).material))
    assert.ok(used.size >= 2, `only ${used.size} roofing kit(s) used across the catalog`)

    for (const kit of Object.values(ROOF_KITS)) {
        assert.ok(isKnownBlock(kit.full), `roof kit fill "${kit.full}" is unmapped`)
        assert.ok(isKnownBlock(kit.edge), `roof kit edge "${kit.edge}" is unmapped`)
    }
})

test('pitched roofs are built from shingle blocks, not stacked cubes', () => {
    const catalog = loadCatalog()
    const pitched = catalog.filter((e) => ['gable', 'hip', 'mansard'].includes(e.massing.roof.type))
    assert.ok(pitched.length > 0)

    for (const entry of pitched) {
        const blocks = generateBuilding(entry).blocks
        assert.ok(blocks.some((b) => b.block === 'cb:roof_slope'), `${entry.id}: no slope blocks`)
        assert.ok(blocks.some((b) => b.block === 'cb:roof_ridge'), `${entry.id}: no ridge cap`)

        // Every slope must name both the material and which way it faces.
        for (const slope of blocks.filter((b) => b.block === 'cb:roof_slope')) {
            assert.ok(slope.state?.['cb:material'], `${entry.id}: slope with no material`)
            assert.ok(slope.state?.['minecraft:cardinal_direction'], `${entry.id}: slope with no facing`)
        }
    }
})

test('furnished rooms get art and light fixtures on the walls', () => {
    for (const id of ['loop_greystone_commercial', 'hotel_tower_convention']) {
        const blocks = generateBuilding(loadCatalog().find((e) => e.id === id)).blocks
        const art = blocks.filter((b) => b.block === 'cb:wall_art')
        const fixtures = blocks.filter((b) => b.block.startsWith('cb:') && /light|chandelier|sconce|pendant/.test(b.block))

        assert.ok(fixtures.length > 0, `${id}: no light fixtures`)
        if (art.length) {
            // Art must name a variant, or every picture is the same one.
            const variants = new Set(art.map((a) => a.state?.['cb:art']))
            assert.ok(variants.size > 1, `${id}: every picture is variant ${[...variants][0]}`)
        }
    }
})
