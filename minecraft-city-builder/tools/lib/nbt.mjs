/**
 * Little-endian NBT reader/writer — the encoding Bedrock uses for
 * `.mcstructure` files (uncompressed, root is a named compound).
 *
 * Compound payloads are `Map`s, not plain objects, because key order must
 * survive a read/write cycle byte-for-byte and JS objects silently reorder
 * integer-like keys (`block_position_data` is keyed by block index).
 *
 * Node shapes:
 *   { type: TAG.Byte|Short|Int|Float|Double, value: number }
 *   { type: TAG.Long,        value: bigint }
 *   { type: TAG.String,      value: string }
 *   { type: TAG.ByteArray|IntArray, value: number[] }
 *   { type: TAG.LongArray,   value: bigint[] }
 *   { type: TAG.List,        elementType: TAG, value: node[] }
 *   { type: TAG.Compound,    value: Map<string, node> }
 */

export const TAG = {
    End: 0,
    Byte: 1,
    Short: 2,
    Int: 3,
    Long: 4,
    Float: 5,
    Double: 6,
    ByteArray: 7,
    String: 8,
    List: 9,
    Compound: 10,
    IntArray: 11,
    LongArray: 12
}

export const TAG_NAME = Object.fromEntries(Object.entries(TAG).map(([name, id]) => [id, name.toLowerCase()]))
export const TAG_ID = Object.fromEntries(Object.entries(TAG_NAME).map(([id, name]) => [name, Number(id)]))

// --- reading ---------------------------------------------------------------

class Reader {
    constructor(buffer) {
        this.buf = buffer
        this.off = 0
    }

    need(bytes) {
        if (this.off + bytes > this.buf.length) {
            throw new Error(`NBT truncated: wanted ${bytes} bytes at offset ${this.off}, have ${this.buf.length - this.off}`)
        }
    }

    byte() {
        this.need(1)
        return this.buf.readInt8(this.off++)
    }

    short() {
        this.need(2)
        const v = this.buf.readInt16LE(this.off)
        this.off += 2
        return v
    }

    ushort() {
        this.need(2)
        const v = this.buf.readUInt16LE(this.off)
        this.off += 2
        return v
    }

    int() {
        this.need(4)
        const v = this.buf.readInt32LE(this.off)
        this.off += 4
        return v
    }

    long() {
        this.need(8)
        const v = this.buf.readBigInt64LE(this.off)
        this.off += 8
        return v
    }

    float() {
        this.need(4)
        const v = this.buf.readFloatLE(this.off)
        this.off += 4
        return v
    }

    double() {
        this.need(8)
        const v = this.buf.readDoubleLE(this.off)
        this.off += 8
        return v
    }

    string() {
        const length = this.ushort()
        this.need(length)
        const v = this.buf.toString('utf8', this.off, this.off + length)
        this.off += length
        return v
    }

    payload(type) {
        switch (type) {
            case TAG.Byte:
                return { type, value: this.byte() }
            case TAG.Short:
                return { type, value: this.short() }
            case TAG.Int:
                return { type, value: this.int() }
            case TAG.Long:
                return { type, value: this.long() }
            case TAG.Float:
                return { type, value: this.float() }
            case TAG.Double:
                return { type, value: this.double() }
            case TAG.String:
                return { type, value: this.string() }
            case TAG.ByteArray: {
                const n = this.int()
                const value = []
                for (let i = 0; i < n; i++) value.push(this.byte())
                return { type, value }
            }
            case TAG.IntArray: {
                const n = this.int()
                const value = []
                for (let i = 0; i < n; i++) value.push(this.int())
                return { type, value }
            }
            case TAG.LongArray: {
                const n = this.int()
                const value = []
                for (let i = 0; i < n; i++) value.push(this.long())
                return { type, value }
            }
            case TAG.List: {
                const elementType = this.byte()
                const n = this.int()
                const value = []
                for (let i = 0; i < n; i++) value.push(this.payload(elementType))
                return { type, elementType, value }
            }
            case TAG.Compound: {
                const value = new Map()
                for (;;) {
                    const childType = this.byte()
                    if (childType === TAG.End) break
                    const name = this.string()
                    value.set(name, this.payload(childType))
                }
                return { type, value }
            }
            default:
                throw new Error(`NBT: unknown tag type ${type} at offset ${this.off - 1}`)
        }
    }
}

/** Read a little-endian NBT buffer. Returns `{ name, root }`. */
export function readNbt(buffer) {
    const reader = new Reader(buffer)
    const type = reader.byte()
    if (type !== TAG.Compound) throw new Error(`NBT: root tag must be a compound, got type ${type}`)
    const name = reader.string()
    const root = reader.payload(TAG.Compound)
    return { name, root, bytesRead: reader.off }
}

// --- writing ---------------------------------------------------------------

class Writer {
    constructor() {
        this.chunks = []
    }

    push(buffer) {
        this.chunks.push(buffer)
    }

    byte(v) {
        const b = Buffer.alloc(1)
        b.writeInt8(v | 0)
        this.push(b)
    }

    short(v) {
        const b = Buffer.alloc(2)
        b.writeInt16LE(v | 0)
        this.push(b)
    }

    ushort(v) {
        const b = Buffer.alloc(2)
        b.writeUInt16LE(v)
        this.push(b)
    }

    int(v) {
        const b = Buffer.alloc(4)
        b.writeInt32LE(v | 0)
        this.push(b)
    }

    long(v) {
        const b = Buffer.alloc(8)
        b.writeBigInt64LE(BigInt(v))
        this.push(b)
    }

    float(v) {
        const b = Buffer.alloc(4)
        b.writeFloatLE(v)
        this.push(b)
    }

    double(v) {
        const b = Buffer.alloc(8)
        b.writeDoubleLE(v)
        this.push(b)
    }

    string(v) {
        const bytes = Buffer.from(v, 'utf8')
        if (bytes.length > 0xffff) throw new Error(`NBT: string too long (${bytes.length} bytes)`)
        this.ushort(bytes.length)
        this.push(bytes)
    }

    payload(node) {
        switch (node.type) {
            case TAG.Byte:
                return this.byte(node.value)
            case TAG.Short:
                return this.short(node.value)
            case TAG.Int:
                return this.int(node.value)
            case TAG.Long:
                return this.long(node.value)
            case TAG.Float:
                return this.float(node.value)
            case TAG.Double:
                return this.double(node.value)
            case TAG.String:
                return this.string(node.value)
            case TAG.ByteArray:
                this.int(node.value.length)
                for (const v of node.value) this.byte(v)
                return
            case TAG.IntArray:
                this.int(node.value.length)
                for (const v of node.value) this.int(v)
                return
            case TAG.LongArray:
                this.int(node.value.length)
                for (const v of node.value) this.long(v)
                return
            case TAG.List: {
                // An empty list still needs an element type; End is the conventional filler.
                const elementType = node.value.length ? (node.elementType ?? node.value[0].type) : (node.elementType ?? TAG.End)
                this.byte(elementType)
                this.int(node.value.length)
                for (const child of node.value) this.payload(child)
                return
            }
            case TAG.Compound: {
                for (const [name, child] of node.value) {
                    this.byte(child.type)
                    this.string(name)
                    this.payload(child)
                }
                this.byte(TAG.End)
                return
            }
            default:
                throw new Error(`NBT: cannot write unknown tag type ${node.type}`)
        }
    }

    finish() {
        return Buffer.concat(this.chunks)
    }
}

/** Write a little-endian NBT buffer from `{ name, root }`. */
export function writeNbt(root, name = '') {
    if (root.type !== TAG.Compound) throw new Error('NBT: root tag must be a compound')
    const writer = new Writer()
    writer.byte(TAG.Compound)
    writer.string(name)
    writer.payload(root)
    return writer.finish()
}

// --- construction helpers --------------------------------------------------

export const nbt = {
    byte: (value) => ({ type: TAG.Byte, value }),
    short: (value) => ({ type: TAG.Short, value }),
    int: (value) => ({ type: TAG.Int, value }),
    long: (value) => ({ type: TAG.Long, value: BigInt(value) }),
    float: (value) => ({ type: TAG.Float, value }),
    double: (value) => ({ type: TAG.Double, value }),
    string: (value) => ({ type: TAG.String, value }),
    byteArray: (value) => ({ type: TAG.ByteArray, value }),
    intArray: (value) => ({ type: TAG.IntArray, value }),
    longArray: (value) => ({ type: TAG.LongArray, value: value.map(BigInt) }),
    list: (elementType, value) => ({ type: TAG.List, elementType, value }),
    compound: (entries = []) => ({
        type: TAG.Compound,
        value: entries instanceof Map ? entries : new Map(entries)
    })
}

/** Read a child of a compound, asserting its tag type. */
export function get(compound, key, expectedType) {
    const node = compound?.value?.get(key)
    if (node === undefined) return undefined
    if (expectedType !== undefined && node.type !== expectedType) {
        throw new Error(`NBT: "${key}" is ${TAG_NAME[node.type]}, expected ${TAG_NAME[expectedType]}`)
    }
    return node
}
