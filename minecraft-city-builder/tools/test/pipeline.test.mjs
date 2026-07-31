/**
 * M1 test suite: `node --test tools/test/`
 *
 * Covers the two failure modes that make structure pipelines untrustworthy —
 * silently mangled directional block states, and dropped block entities.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TAG, nbt, readNbt, writeNbt, get } from '../lib/nbt.mjs'
import { nbtToJson, jsonToNbt, stateToNbt, stateFromNbt, blockKey } from '../lib/nbt-json.mjs'
import { parseMcStructure, writeMcStructure, indexOf, positionOf, blockVersion, PaletteBuilder } from '../lib/mcstructure.mjs'
import { moduleToModel, modelToModule, validateModule } from '../lib/module-format.mjs'
import { resolveBlock, validateStyle, missingTokens, tokensUsed } from '../lib/palette.mjs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

const testRoom = () => readJson('fixtures/test_room.module.json')
const brownstone = () => readJson('data/styles/brownstone.json')

/** Compile a module all the way to bytes and read it back. */
const roundTrip = (module, style) => parseMcStructure(writeMcStructure(moduleToModel(module, { style })))

// --- NBT layer -------------------------------------------------------------

test('NBT: every tag type survives a byte-level round trip', () => {
    const root = nbt.compound([
        ['aByte', nbt.byte(-128)],
        ['aShort', nbt.short(-32768)],
        ['anInt', nbt.int(-2147483648)],
        ['aLong', nbt.long('-9223372036854775808')],
        ['aFloat', nbt.float(0.5)],
        ['aDouble', nbt.double(Math.PI)],
        ['aString', nbt.string('unicode: ✅ 東京 \n newline')],
        ['byteArray', nbt.byteArray([-1, 0, 127])],
        ['intArray', nbt.intArray([1, -1, 999999])],
        ['longArray', nbt.longArray(['1', '-1'])],
        ['emptyList', nbt.list(TAG.End, [])],
        ['listOfCompounds', nbt.list(TAG.Compound, [nbt.compound([['x', nbt.int(1)]])])],
        ['nested', nbt.compound([['deep', nbt.compound([['deeper', nbt.string('ok')]])]])]
    ])

    const bytes = writeNbt(root, 'Structure')
    const { name, root: parsed } = readNbt(bytes)

    assert.equal(name, 'Structure')
    assert.ok(writeNbt(parsed, name).equals(bytes), 'rewritten bytes must be identical')
    assert.equal(get(parsed, 'aLong').value, -9223372036854775808n)
    assert.equal(get(parsed, 'aString').value, 'unicode: ✅ 東京 \n newline')
    assert.equal(get(parsed, 'aDouble').value, Math.PI)
})

test('NBT: compound key order is preserved, including integer-like keys', () => {
    // block_position_data is keyed by block index; a plain JS object would
    // reorder these and corrupt the file.
    const root = nbt.compound([
        ['10', nbt.int(1)],
        ['2', nbt.int(2)],
        ['0', nbt.int(3)]
    ])
    const parsed = readNbt(writeNbt(root, '')).root
    assert.deepEqual([...parsed.value.keys()], ['10', '2', '0'])
})

test('NBT: truncated input fails loudly rather than returning junk', () => {
    const bytes = writeNbt(nbt.compound([['x', nbt.int(1)]]), '')
    assert.throws(() => readNbt(bytes.subarray(0, bytes.length - 3)), /truncated/)
})

// --- nbt-json layer --------------------------------------------------------

test('nbt-json: block entity payloads survive JSON encoding', () => {
    const chest = nbt.compound([
        ['id', nbt.string('Chest')],
        ['Items', nbt.list(TAG.Compound, [nbt.compound([['Count', nbt.byte(12)], ['Name', nbt.string('minecraft:oak_planks')]])])],
        ['x', nbt.int(-40)]
    ])
    const restored = jsonToNbt(nbtToJson(chest))
    assert.ok(writeNbt(restored, '').equals(writeNbt(chest, '')))
})

test('nbt-json: integer-like compound keys are rejected, not silently reordered', () => {
    const bad = nbt.compound([['0', nbt.int(1)]])
    assert.throws(() => nbtToJson(bad), /integer-like/)
})

test('nbt-json: block states map onto plain JSON by type', () => {
    const state = { upside_down_bit: true, weirdo_direction: 3, wall_connection_type_east: 'short' }
    assert.deepEqual(stateFromNbt(stateToNbt(state)), state)

    const compound = stateToNbt(state)
    assert.equal(compound.value.get('upside_down_bit').type, TAG.Byte)
    assert.equal(compound.value.get('weirdo_direction').type, TAG.Int)
    assert.equal(compound.value.get('wall_connection_type_east').type, TAG.String)
})

test('nbt-json: state serialization is key-order independent', () => {
    const a = stateToNbt({ b: 1, a: 2 })
    const b = stateToNbt({ a: 2, b: 1 })
    assert.ok(writeNbt(a, '').equals(writeNbt(b, '')))
    assert.equal(blockKey('minecraft:x', { b: 1, a: 2 }), blockKey('minecraft:x', { a: 2, b: 1 }))
})

test('nbt-json: non-integer block state values are rejected', () => {
    assert.throws(() => stateToNbt({ direction: 1.5 }), /must be an integer/)
    assert.throws(() => stateToNbt({ direction: null }), /boolean, integer, or string/)
})

// --- index math ------------------------------------------------------------

test('mcstructure: index and position are inverses across a non-cubic volume', () => {
    const size = [7, 4, 11]
    let index = 0
    for (let x = 0; x < size[0]; x++) {
        for (let y = 0; y < size[1]; y++) {
            for (let z = 0; z < size[2]; z++, index++) {
                assert.equal(indexOf(size, x, y, z), index, `indexOf(${x},${y},${z})`)
                assert.deepEqual(positionOf(size, index), [x, y, z])
            }
        }
    }
    assert.equal(index, size[0] * size[1] * size[2])
})

test('mcstructure: block version packs as major/minor/patch/revision', () => {
    assert.equal(blockVersion(1, 21, 20, 0), (1 << 24) | (21 << 16) | (20 << 8))
    assert.equal(blockVersion(1, 0, 0, 1), 16777217)
})

test('mcstructure: palette interning de-duplicates by name and state', () => {
    const builder = new PaletteBuilder(1)
    const a = builder.intern('minecraft:oak_stairs', { weirdo_direction: 0 })
    const b = builder.intern('minecraft:oak_stairs', { weirdo_direction: 0 })
    const c = builder.intern('minecraft:oak_stairs', { weirdo_direction: 1 })
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.equal(builder.entries.length, 2)
})

// --- module <-> mcstructure ------------------------------------------------

test('module -> mcstructure -> module preserves the reference room exactly', () => {
    const original = testRoom()
    const model = roundTrip(original, brownstone())
    const restored = modelToModule(model, { id: original.id, category: original.category })

    assert.deepEqual(restored.footprint, original.footprint)
    assert.equal(restored.blocks.length, original.blocks.length)

    // Compare as position -> resolved block, since palette slots renumber and
    // block order within the array is not meaningful.
    const style = brownstone()
    const expected = new Map(
        original.blocks.map((block) => {
            const { name, state } = resolveBlock(block.block, block.state ?? {}, style)
            return [block.pos.join(','), { key: blockKey(name, state), waterlogged: Boolean(block.waterlogged) }]
        })
    )
    for (const block of restored.blocks) {
        const want = expected.get(block.pos.join(','))
        assert.ok(want, `unexpected block at ${block.pos}`)
        assert.equal(blockKey(block.block, block.state ?? {}), want.key, `block at ${block.pos}`)
        assert.equal(Boolean(block.waterlogged), want.waterlogged, `waterlogging at ${block.pos}`)
    }
})

test('directional block states survive compilation unchanged', () => {
    const model = roundTrip(testRoom(), brownstone())
    const restored = modelToModule(model)
    const at = (pos) => restored.blocks.find((b) => b.pos.join(',') === pos.join(','))

    assert.deepEqual(at([1, 1, 1]).state, { weirdo_direction: 0, upside_down_bit: false })
    assert.deepEqual(at([5, 1, 5]).state, { weirdo_direction: 3, upside_down_bit: true })
    assert.deepEqual(at([1, 2, 3]).state, { facing_direction: 4 })
    assert.deepEqual(at([2, 2, 1]).state, { direction: 2, open_bit: true, upside_down_bit: false })
    assert.deepEqual(at([3, 1, 0]).state, { direction: 0, door_hinge_bit: false, open_bit: false, upper_block_bit: false })
    assert.deepEqual(at([3, 2, 0]).state, { direction: 0, door_hinge_bit: false, open_bit: false, upper_block_bit: true })
    assert.deepEqual(at([4, 2, 1]).state, { ground_sign_direction: 8 })
})

test('block entities survive with their payloads intact', () => {
    const original = testRoom()
    const model = roundTrip(original, brownstone())
    const restored = modelToModule(model)

    assert.equal(restored.block_entities.length, 2)

    const chest = restored.block_entities.find((entry) => entry.data.value.id.value === 'Chest')
    assert.deepEqual(chest.pos, [2, 1, 5])
    const items = chest.data.value.Items.value
    assert.equal(items.length, 2)
    assert.equal(items[0].value.Name.value, 'minecraft:oak_planks')
    assert.equal(items[0].value.Count.value, 12)
    assert.equal(items[1].value.Name.value, 'minecraft:diamond_pickaxe')

    const sign = restored.block_entities.find((entry) => entry.data.value.id.value === 'Sign')
    assert.equal(sign.data.value.FrontText.value.Text.value, 'CITY BUILDER\nM1 test room')
    assert.equal(sign.data.value.FrontText.value.SignTextColor.value, -16777216)
})

test('waterlogging round-trips through layer 1', () => {
    const model = roundTrip(testRoom(), brownstone())
    const restored = modelToModule(model)
    const slab = restored.blocks.find((b) => b.block === 'minecraft:oak_slab')

    assert.equal(slab.waterlogged, true)
    assert.deepEqual(slab.pos, [4, 1, 3])

    // Nothing else should have picked up water.
    assert.equal(restored.blocks.filter((b) => b.waterlogged).length, 1)
})

test('structure void and explicit air stay distinct', () => {
    const model = roundTrip(testRoom(), brownstone())
    const restored = modelToModule(model)

    // [3,1,3] is explicit air and must be emitted; [2,1,2] is interior space
    // the module never mentions and must stay structure void.
    assert.equal(restored.blocks.find((b) => b.pos.join(',') === '3,1,3').block, 'minecraft:air')
    assert.equal(restored.blocks.find((b) => b.pos.join(',') === '2,1,2'), undefined)
    assert.equal(model.layers[0][indexOf(model.size, 2, 1, 2)], -1)
    assert.ok(model.layers[0][indexOf(model.size, 3, 1, 3)] >= 0)
})

test('an "extra" layer-1 block that is not water round-trips', () => {
    const module = {
        id: 'extra_layer',
        footprint: [1, 1, 1],
        category: 'fixture',
        palette: {},
        blocks: [{ pos: [0, 0, 0], block: 'minecraft:oak_fence', extra: { block: 'minecraft:flowing_water', state: { liquid_depth: 2 } } }]
    }
    const restored = modelToModule(roundTrip(module))
    assert.deepEqual(restored.blocks[0].extra, { block: 'minecraft:flowing_water', state: { liquid_depth: 2 } })
    assert.equal(restored.blocks[0].waterlogged, undefined)
})

test('emitted .mcstructure has the shape Bedrock expects', () => {
    const bytes = writeMcStructure(moduleToModel(testRoom(), { style: brownstone(), origin: [10, 64, -20] }))
    const { name, root } = readNbt(bytes)

    assert.equal(name, '')
    assert.equal(get(root, 'format_version', TAG.Int).value, 1)
    assert.deepEqual(get(root, 'size', TAG.List).value.map((n) => n.value), [7, 4, 7])
    assert.deepEqual(get(root, 'structure_world_origin', TAG.List).value.map((n) => n.value), [10, 64, -20])

    const structure = get(root, 'structure', TAG.Compound)
    const layers = get(structure, 'block_indices', TAG.List)
    assert.equal(layers.value.length, 2, 'exactly two block layers')
    for (const layer of layers.value) assert.equal(layer.value.length, 7 * 4 * 7)

    const palette = get(get(get(structure, 'palette', TAG.Compound), 'default', TAG.Compound), 'block_palette', TAG.List)
    for (const entry of palette.value) {
        assert.equal(get(entry, 'name', TAG.String).type, TAG.String)
        assert.equal(get(entry, 'states', TAG.Compound).type, TAG.Compound)
        assert.equal(get(entry, 'version', TAG.Int).type, TAG.Int)
    }
})

test('serialized .mcstructure bytes are deterministic', () => {
    const once = writeMcStructure(moduleToModel(testRoom(), { style: brownstone() }))
    const twice = writeMcStructure(moduleToModel(testRoom(), { style: brownstone() }))
    assert.ok(once.equals(twice))
})

// --- palette tokens --------------------------------------------------------

test('the same module compiles to different blocks under different styles', () => {
    const module = testRoom()
    const brown = modelToModule(roundTrip(module, brownstone()))
    const glass = modelToModule(roundTrip(module, readJson('data/styles/curtain_wall.json')))

    const wallAt = (m) => m.blocks.find((b) => b.pos.join(',') === '0,1,0').block
    assert.equal(wallAt(brown), 'minecraft:brick_block')
    assert.equal(wallAt(glass), 'minecraft:quartz_block')
    assert.notEqual(wallAt(brown), wallAt(glass))
})

test('a style binding may carry state, which the block can override', () => {
    const style = { id: 's', tokens: { $A: { block: 'minecraft:log', state: { pillar_axis: 'x', extra: 1 } } } }
    assert.deepEqual(resolveBlock('$A', {}, style), { name: 'minecraft:log', state: { pillar_axis: 'x', extra: 1 } })
    assert.deepEqual(resolveBlock('$A', { pillar_axis: 'y' }, style), {
        name: 'minecraft:log',
        state: { pillar_axis: 'y', extra: 1 }
    })
})

test('concrete block names pass through untouched', () => {
    assert.deepEqual(resolveBlock('minecraft:stone', { a: 1 }, { id: 's', tokens: {} }), {
        name: 'minecraft:stone',
        state: { a: 1 }
    })
})

test('an unbound token fails compilation instead of emitting a broken structure', () => {
    const module = testRoom()
    assert.throws(() => moduleToModel(module, { style: { id: 'partial', tokens: { $STYLE_WALL: 'minecraft:stone' } } }), /unresolved palette token/)
    assert.throws(() => moduleToModel(module), /unresolved palette token/)
})

test('missingTokens reports exactly what a style fails to bind', () => {
    const module = testRoom()
    assert.deepEqual(tokensUsed(module), new Set(['$STYLE_WALL', '$STYLE_FLOOR', '$STYLE_CEILING']))
    assert.deepEqual(missingTokens(module, { id: 'p', tokens: { $STYLE_WALL: 'minecraft:stone' } }), [
        '$STYLE_CEILING',
        '$STYLE_FLOOR'
    ])
    assert.deepEqual(missingTokens(module, brownstone()), [])
})

test('style files are validated', () => {
    assert.deepEqual(validateStyle(brownstone()), [])
    assert.deepEqual(validateStyle(readJson('data/styles/curtain_wall.json')), [])
    assert.ok(validateStyle({ id: 'x', tokens: { lowercase: 'minecraft:stone' } }).some((e) => /UPPER_SNAKE_CASE/.test(e)))
    assert.ok(validateStyle({ id: 'x', tokens: { $A: '$B' } }).some((e) => /binds to another token/.test(e)))
})

// --- module validation -----------------------------------------------------

test('the reference module is valid, including under §4.2 dimension rules', () => {
    assert.deepEqual(validateModule(testRoom()), [])
    assert.deepEqual(validateModule(testRoom(), { enforceDimensions: true }), [])
})

test('validation catches the mistakes that produce silently broken structures', () => {
    const base = testRoom()
    const withBlocks = (blocks) => ({ ...base, blocks })

    const outOfBounds = withBlocks([{ pos: [9, 0, 0], block: 'minecraft:stone' }])
    assert.ok(validateModule(outOfBounds).some((e) => /outside footprint/.test(e)))

    const duplicate = withBlocks([
        { pos: [1, 0, 1], block: 'minecraft:stone' },
        { pos: [1, 0, 1], block: 'minecraft:dirt' }
    ])
    assert.ok(validateModule(duplicate).some((e) => /duplicate position/.test(e)))

    const undeclared = withBlocks([{ pos: [1, 0, 1], block: '$STYLE_MISSPELLED' }])
    assert.ok(validateModule(undeclared).some((e) => /not declared in "palette"/.test(e)))

    const conflicting = withBlocks([{ pos: [1, 0, 1], block: 'minecraft:oak_slab', waterlogged: true, extra: { block: 'minecraft:lava' } }])
    assert.ok(validateModule(conflicting).some((e) => /not both/.test(e)))

    const orphanEntity = { ...base, block_entities: [{ pos: [2, 1, 2], data: { type: 'compound', value: {} } }] }
    assert.ok(validateModule(orphanEntity).some((e) => /no block at/.test(e)))

    assert.ok(validateModule({ ...base, footprint: [0, 4, 7] }).some((e) => /positive integers/.test(e)))
    assert.ok(validateModule({ ...base, connections: { up: [] } }).some((e) => /unknown direction/.test(e)))
})

test('§4.2 dimension rules are enforced only when asked', () => {
    const odd = { ...testRoom(), footprint: [9, 4, 9] }
    // Positions from the 7x7 room are still in bounds inside 9x9.
    assert.deepEqual(validateModule(odd), [])
    assert.ok(validateModule(odd, { enforceDimensions: true }).some((e) => /§4.2/.test(e)))

    const facade = { id: 'bay', footprint: [5, 4, 1], category: 'facade', palette: {}, blocks: [] }
    assert.deepEqual(validateModule(facade, { enforceDimensions: true }), [])
    assert.ok(
        validateModule({ ...facade, footprint: [6, 4, 1] }, { enforceDimensions: true }).some((e) => /§4.2/.test(e))
    )
})

test('a module that fails validation never reaches the emitter', () => {
    assert.throws(() => moduleToModel({ ...testRoom(), blocks: [{ pos: [99, 0, 0], block: 'minecraft:stone' }] }), /is invalid/)
})

// --- capture direction -----------------------------------------------------

test('mcstructure -> module handles a structure authored outside the pipeline', () => {
    // Mimics a structure-block capture: palette slots in arbitrary order, a
    // mixed block version, structure void, and a block entity.
    const size = [2, 1, 2]
    const model = {
        formatVersion: 1,
        size,
        origin: [0, 0, 0],
        palette: [
            { name: 'minecraft:air', state: {}, version: blockVersion(1, 21, 20) },
            { name: 'minecraft:chest', state: { minecraft_cardinal_direction: 'north' }, version: blockVersion(1, 21, 20) },
            { name: 'minecraft:stone', state: {}, version: blockVersion(1, 20, 0) },
            { name: 'minecraft:water', state: { liquid_depth: 0 }, version: blockVersion(1, 21, 20) }
        ],
        layers: [
            Int32Array.from([2, 1, -1, 2]),
            Int32Array.from([0, 0, -1, 3])
        ],
        blockEntities: new Map([[indexOf(size, 0, 0, 1), jsonToNbt({ type: 'compound', value: { id: { type: 'string', value: 'Chest' } } })]]),
        entities: []
    }

    const module = modelToModule(model, { id: 'captured', category: 'fixture' })
    assert.deepEqual(validateModule(module), [])
    assert.equal(module.blocks.length, 3, 'the structure-void cell is omitted')

    const chest = module.blocks.find((b) => b.block === 'minecraft:chest')
    assert.deepEqual(chest.pos, [0, 0, 1])
    assert.deepEqual(chest.state, { minecraft_cardinal_direction: 'north' })

    // The odd-version stone carries an explicit override; the majority version
    // sits at module level.
    assert.equal(module.block_version, blockVersion(1, 21, 20))
    assert.equal(module.blocks.find((b) => b.block === 'minecraft:stone' && b.pos.join(',') === '0,0,0').version, blockVersion(1, 20, 0))

    assert.equal(module.blocks.find((b) => b.pos.join(',') === '1,0,1').waterlogged, true)
    assert.equal(module.block_entities.length, 1)

    // And back again, with the version override intact.
    const rebuilt = modelToModule(roundTrip(module))
    assert.equal(rebuilt.blocks.find((b) => b.pos.join(',') === '0,0,0').version, blockVersion(1, 20, 0))
})

test('a corrupt palette reference is reported, not silently dropped', () => {
    const model = {
        formatVersion: 1,
        size: [1, 1, 1],
        origin: [0, 0, 0],
        palette: [{ name: 'minecraft:stone', state: {}, version: 1 }],
        layers: [Int32Array.from([7]), Int32Array.from([-1])],
        blockEntities: new Map(),
        entities: []
    }
    assert.throws(() => modelToModule(model), /missing palette entry/)
})

test('a layer of the wrong length is rejected', () => {
    const model = {
        size: [2, 2, 2],
        origin: [0, 0, 0],
        palette: [{ name: 'minecraft:stone', state: {}, version: 1 }],
        layers: [new Int32Array(8), new Int32Array(3)],
        blockEntities: new Map(),
        entities: []
    }
    assert.throws(() => writeMcStructure(model), /expected 8/)
})
