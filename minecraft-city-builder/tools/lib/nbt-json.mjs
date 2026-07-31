/**
 * Lossless NBT <-> JSON encoding for the arbitrary NBT that rides along inside
 * modules: block entity payloads (chest contents, sign text, item frames) and
 * entity payloads.
 *
 * JSON has no type system, so every node carries its tag explicitly:
 *
 *   { "type": "int",    "value": 5 }
 *   { "type": "long",   "value": "-42" }              longs are strings
 *   { "type": "string", "value": "Welcome" }
 *   { "type": "list",   "elementType": "compound", "value": [ ... ] }
 *   { "type": "compound", "value": { "id": { ... } } }
 *
 * Block *states* do not use this encoding — they are simple enough to express
 * naturally (see `stateToNbt`), which keeps hand-authored modules readable.
 */

import { TAG, TAG_NAME, TAG_ID, nbt } from './nbt.mjs'

const INTEGER_KEY = /^-?\d+$/

/** NBT node -> plain JSON. */
export function nbtToJson(node) {
    switch (node.type) {
        case TAG.Byte:
        case TAG.Short:
        case TAG.Int:
        case TAG.Float:
        case TAG.Double:
            return { type: TAG_NAME[node.type], value: node.value }
        case TAG.Long:
            return { type: 'long', value: node.value.toString() }
        case TAG.String:
            return { type: 'string', value: node.value }
        case TAG.ByteArray:
        case TAG.IntArray:
            return { type: TAG_NAME[node.type], value: [...node.value] }
        case TAG.LongArray:
            return { type: 'longarray', value: node.value.map((v) => v.toString()) }
        case TAG.List:
            return {
                type: 'list',
                elementType: TAG_NAME[node.elementType ?? TAG.End],
                value: node.value.map(nbtToJson)
            }
        case TAG.Compound: {
            const value = {}
            for (const [key, child] of node.value) {
                // JS objects reorder integer-like keys, which would silently
                // corrupt tag order on the way back. Refuse rather than guess.
                if (INTEGER_KEY.test(key)) {
                    throw new Error(`nbt-json: compound key "${key}" is integer-like and cannot round-trip through a JSON object`)
                }
                value[key] = nbtToJson(child)
            }
            return { type: 'compound', value }
        }
        default:
            throw new Error(`nbt-json: cannot encode tag type ${node.type}`)
    }
}

/** Plain JSON -> NBT node. */
export function jsonToNbt(json, path = '$') {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error(`nbt-json: ${path} must be an object with "type" and "value"`)
    }
    const type = TAG_ID[json.type]
    if (type === undefined) throw new Error(`nbt-json: ${path} has unknown type "${json.type}"`)

    switch (type) {
        case TAG.Byte:
        case TAG.Short:
        case TAG.Int:
        case TAG.Float:
        case TAG.Double:
            if (typeof json.value !== 'number') throw new Error(`nbt-json: ${path} value must be a number`)
            return { type, value: json.value }
        case TAG.Long:
            return nbt.long(json.value)
        case TAG.String:
            if (typeof json.value !== 'string') throw new Error(`nbt-json: ${path} value must be a string`)
            return { type, value: json.value }
        case TAG.ByteArray:
        case TAG.IntArray:
            return { type, value: [...json.value] }
        case TAG.LongArray:
            return nbt.longArray(json.value)
        case TAG.List: {
            const elementType = TAG_ID[json.elementType ?? 'end']
            if (elementType === undefined) throw new Error(`nbt-json: ${path} has unknown elementType "${json.elementType}"`)
            return nbt.list(
                elementType,
                json.value.map((child, i) => jsonToNbt(child, `${path}[${i}]`))
            )
        }
        case TAG.Compound: {
            const entries = new Map()
            for (const [key, child] of Object.entries(json.value)) {
                entries.set(key, jsonToNbt(child, `${path}.${key}`))
            }
            return { type, value: entries }
        }
        default:
            throw new Error(`nbt-json: cannot decode tag type ${json.type}`)
    }
}

// --- block states ----------------------------------------------------------
//
// Bedrock block states only ever use byte (as a boolean), int, or string, so
// they map onto plain JSON with no ambiguity and no wrapper objects:
//
//   { "weirdo_direction": 2, "upside_down_bit": true, "wall_connection_type_east": "short" }

/** Plain state object -> NBT compound. */
export function stateToNbt(state = {}) {
    const entries = new Map()
    // Sorted so two modules describing the same state always serialize
    // identically, which is what makes palette de-duplication work.
    for (const key of Object.keys(state).sort()) {
        const value = state[key]
        if (typeof value === 'boolean') entries.set(key, nbt.byte(value ? 1 : 0))
        else if (typeof value === 'number') {
            if (!Number.isInteger(value)) throw new Error(`block state "${key}" must be an integer, got ${value}`)
            entries.set(key, nbt.int(value))
        } else if (typeof value === 'string') entries.set(key, nbt.string(value))
        else throw new Error(`block state "${key}" must be a boolean, integer, or string`)
    }
    return { type: TAG.Compound, value: entries }
}

/** NBT compound -> plain state object. */
export function stateFromNbt(compound) {
    const state = {}
    if (!compound) return state
    for (const [key, node] of compound.value) {
        switch (node.type) {
            case TAG.Byte:
                state[key] = node.value !== 0
                break
            case TAG.Int:
            case TAG.Short:
                state[key] = node.value
                break
            case TAG.String:
                state[key] = node.value
                break
            default:
                throw new Error(`block state "${key}" has unexpected tag type ${TAG_NAME[node.type]}`)
        }
    }
    return state
}

/** Stable key for de-duplicating (name, state) pairs into a palette. */
export function blockKey(name, state = {}) {
    const parts = Object.keys(state)
        .sort()
        .map((key) => `${key}=${typeof state[key] === 'boolean' ? (state[key] ? '1b' : '0b') : JSON.stringify(state[key])}`)
    return `${name}[${parts.join(',')}]`
}
