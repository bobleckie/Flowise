/** Minimal shared argument parsing for the M1 command-line tools. */

export function parseArgs(argv, { flags = [], options = [], aliases = {} } = {}) {
    const result = { _: [] }

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]

        let name
        let inline
        if (arg.startsWith('--')) {
            ;[name, inline] = splitOnce(arg.slice(2))
        } else if (arg.length > 1 && arg.startsWith('-')) {
            ;[name, inline] = splitOnce(arg.slice(1))
            const expanded = aliases[name]
            if (!expanded) throw new Error(`unknown option -${name}`)
            name = expanded
        } else {
            result._.push(arg)
            continue
        }

        if (flags.includes(name)) {
            result[name] = true
        } else if (options.includes(name)) {
            const value = inline ?? argv[++i]
            if (value === undefined) throw new Error(`--${name} requires a value`)
            result[name] = value
        } else {
            throw new Error(`unknown option --${name}`)
        }
    }
    return result
}

function splitOnce(text) {
    const at = text.indexOf('=')
    return at === -1 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)]
}

export function fail(message, usage) {
    console.error(`error: ${message}`)
    if (usage) console.error(`\n${usage}`)
    process.exit(1)
}

/**
 * JSON serializer tuned for module files: anything that fits on one line stays
 * on one line, so a block reads as `{ "pos": [ 1, 1, 1 ], "block": "..." }`
 * instead of eleven lines. Keeps modules diffable and reviewable by hand.
 */
const INLINE_WIDTH = 110

export function stringifyModule(module) {
    return `${format(module, '')}\n`
}

function format(value, indent) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)

    const oneLine = JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ')
    if (indent.length + oneLine.length <= INLINE_WIDTH) return oneLine

    const inner = `${indent}  `
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        return `[\n${value.map((item) => inner + format(item, inner)).join(',\n')}\n${indent}]`
    }

    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${format(value[key], inner)}`).join(',\n')}\n${indent}}`
}
