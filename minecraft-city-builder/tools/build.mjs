#!/usr/bin/env node
/**
 * Validate the packs and bundle them into dist/city_builder.mcaddon.
 *
 * Zero dependencies and no external `zip` binary, so this runs the same on
 * Windows (where the add-on gets installed) as it does in CI.
 *
 *   node tools/build.mjs            validate + write dist/city_builder.mcaddon
 *   node tools/build.mjs --check    validate only
 */

import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKS_DIR = join(ROOT, 'packs')
const PACKS = ['city_builder_bp', 'city_builder_rp']
const OUT = join(ROOT, 'dist', 'city_builder.mcaddon')

/** Fixed DOS timestamp (1980-01-01) so identical inputs produce identical archives. */
const DOS_TIME = 0
const DOS_DATE = 33

// --- crc32 -----------------------------------------------------------------

let CRC_TABLE
function crc32(buffer) {
    if (typeof zlibCrc32 === 'function') return zlibCrc32(buffer) >>> 0
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256)
        for (let i = 0; i < 256; i++) {
            let c = i
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            CRC_TABLE[i] = c >>> 0
        }
    }
    let crc = 0xffffffff
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

// --- zip writer ------------------------------------------------------------

function zip(entries) {
    const locals = []
    const central = []
    let offset = 0

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8')
        const compressed = deflateRawSync(data, { level: 9 })
        const sum = crc32(data)

        const local = Buffer.alloc(30 + nameBuf.length)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4) // version needed
        local.writeUInt16LE(0, 6) // flags
        local.writeUInt16LE(8, 8) // method: deflate
        local.writeUInt16LE(DOS_TIME, 10)
        local.writeUInt16LE(DOS_DATE, 12)
        local.writeUInt32LE(sum, 14)
        local.writeUInt32LE(compressed.length, 18)
        local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26)
        local.writeUInt16LE(0, 28) // extra length
        nameBuf.copy(local, 30)

        const dir = Buffer.alloc(46 + nameBuf.length)
        dir.writeUInt32LE(0x02014b50, 0)
        dir.writeUInt16LE(20, 4) // version made by
        dir.writeUInt16LE(20, 6) // version needed
        dir.writeUInt16LE(0, 8)
        dir.writeUInt16LE(8, 10)
        dir.writeUInt16LE(DOS_TIME, 12)
        dir.writeUInt16LE(DOS_DATE, 14)
        dir.writeUInt32LE(sum, 16)
        dir.writeUInt32LE(compressed.length, 20)
        dir.writeUInt32LE(data.length, 24)
        dir.writeUInt16LE(nameBuf.length, 28)
        dir.writeUInt16LE(0, 30) // extra
        dir.writeUInt16LE(0, 32) // comment
        dir.writeUInt16LE(0, 34) // disk
        dir.writeUInt16LE(0, 36) // internal attrs
        dir.writeUInt32LE(0, 38) // external attrs
        dir.writeUInt32LE(offset, 42)
        nameBuf.copy(dir, 46)

        locals.push(local, compressed)
        central.push(dir)
        offset += local.length + compressed.length
    }

    const centralBuf = Buffer.concat(central)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(entries.length, 8)
    eocd.writeUInt16LE(entries.length, 10)
    eocd.writeUInt32LE(centralBuf.length, 12)
    eocd.writeUInt32LE(offset, 16)
    eocd.writeUInt16LE(0, 20)

    return Buffer.concat([...locals, centralBuf, eocd])
}

// --- collection + validation ----------------------------------------------

function walk(dir, out = []) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full, out)
        else out.push(full)
    }
    return out
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
        throw new Error(`${relative(ROOT, path)}: invalid JSON — ${error.message}`)
    }
}

function validate(files) {
    const errors = []

    // Every .json in the packs must parse.
    for (const file of files.filter((f) => f.endsWith('.json'))) {
        try {
            readJson(file)
        } catch (error) {
            errors.push(error.message)
        }
    }

    const manifests = {}
    for (const pack of PACKS) {
        const path = join(PACKS_DIR, pack, 'manifest.json')
        try {
            manifests[pack] = readJson(path)
        } catch (error) {
            errors.push(error.message)
        }
    }
    if (errors.length) return errors

    // UUIDs must be unique across every header and module in the add-on.
    const seen = new Map()
    for (const [pack, manifest] of Object.entries(manifests)) {
        const uuids = [manifest.header?.uuid, ...(manifest.modules ?? []).map((m) => m.uuid)]
        for (const uuid of uuids) {
            if (!uuid) errors.push(`${pack}/manifest.json: missing a uuid`)
            else if (seen.has(uuid)) errors.push(`duplicate uuid ${uuid} in ${pack} and ${seen.get(uuid)}`)
            else seen.set(uuid, pack)
        }
    }

    // The behavior pack must depend on the resource pack by its real UUID+version.
    const bp = manifests['city_builder_bp']
    const rp = manifests['city_builder_rp']
    const link = (bp?.dependencies ?? []).find((d) => d.uuid === rp?.header?.uuid)
    if (!link) {
        errors.push('city_builder_bp/manifest.json: no dependency on the resource pack UUID')
    } else if (JSON.stringify(link.version) !== JSON.stringify(rp.header.version)) {
        errors.push(
            `city_builder_bp/manifest.json: RP dependency version ${JSON.stringify(link.version)} ` +
                `!= RP header version ${JSON.stringify(rp.header.version)}`
        )
    }

    // The script entry point must exist on disk.
    const script = (bp?.modules ?? []).find((m) => m.type === 'script')
    if (script) {
        const entry = join(PACKS_DIR, 'city_builder_bp', script.entry)
        if (!files.includes(entry)) errors.push(`city_builder_bp: script entry "${script.entry}" not found`)
    }

    // Every custom block must have its geometry and textures present, or the
    // pack loads with invisible blocks and an error only in the Content Log.
    const blockDir = join(PACKS_DIR, 'city_builder_bp', 'blocks')
    const blockFiles = files.filter((f) => f.startsWith(blockDir))
    const terrainPath = join(PACKS_DIR, 'city_builder_rp', 'textures', 'terrain_texture.json')
    const terrain = files.includes(terrainPath) ? readJson(terrainPath).texture_data ?? {} : {}

    for (const file of blockFiles) {
        const block = readJson(file)['minecraft:block']
        if (!block) {
            errors.push(`${relative(ROOT, file)}: not a block definition`)
            continue
        }
        const geo = block.components?.['minecraft:geometry']
        const identifier = typeof geo === 'string' ? geo : geo?.identifier
        if (identifier) {
            const geoFile = join(PACKS_DIR, 'city_builder_rp', 'models', 'blocks', `${identifier.replace('geometry.cb_', '')}.geo.json`)
            if (!files.includes(geoFile)) errors.push(`${relative(ROOT, file)}: geometry "${identifier}" has no model`)
        }
        // Every texture named, in components and in permutations.
        const named = new Set()
        const collect = (components) => {
            for (const instance of Object.values(components?.['minecraft:material_instances'] ?? {})) {
                if (instance.texture) named.add(instance.texture)
            }
        }
        collect(block.components)
        for (const permutation of block.permutations ?? []) collect(permutation.components)
        for (const texture of named) {
            if (!terrain[texture]) errors.push(`${relative(ROOT, file)}: texture "${texture}" is not in terrain_texture.json`)
            else {
                const png = join(PACKS_DIR, 'city_builder_rp', `${terrain[texture].textures}.png`)
                if (!files.includes(png)) errors.push(`${relative(ROOT, file)}: ${terrain[texture].textures}.png is missing`)
            }
        }
    }

    // Every texture referenced by item_texture.json must exist.
    const texturesPath = join(PACKS_DIR, 'city_builder_rp', 'textures', 'item_texture.json')
    if (files.includes(texturesPath)) {
        const data = readJson(texturesPath).texture_data ?? {}
        for (const [key, value] of Object.entries(data)) {
            const rel = typeof value.textures === 'string' ? value.textures : value.textures?.[0]
            if (!rel) {
                errors.push(`item_texture.json: "${key}" has no texture path`)
                continue
            }
            const png = join(PACKS_DIR, 'city_builder_rp', `${rel}.png`)
            if (!files.includes(png)) errors.push(`item_texture.json: "${key}" -> ${rel}.png is missing`)
        }
    }

    return errors
}

// --- main ------------------------------------------------------------------

const files = PACKS.flatMap((pack) => walk(join(PACKS_DIR, pack)))
const errors = validate(files)

if (errors.length) {
    console.error('Validation failed:')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
}
console.log(`Validated ${files.length} files across ${PACKS.length} packs.`)

if (process.argv.includes('--check')) process.exit(0)

const entries = files.map((file) => ({
    // .mcaddon entries are pack-folder relative, always with forward slashes.
    name: relative(PACKS_DIR, file).split(sep).join('/'),
    data: readFileSync(file)
}))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, zip(entries))
console.log(`Wrote ${relative(ROOT, OUT)} (${entries.length} entries, ${statSync(OUT).size} bytes)`)
