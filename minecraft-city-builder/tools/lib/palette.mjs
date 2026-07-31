/**
 * `$STYLE_*` palette token resolution (SPEC.md §4.1).
 *
 * One authored module ships as many visually distinct styles because its block
 * names are tokens, not concrete blocks. A style file binds them:
 *
 *   {
 *     "id": "brownstone",
 *     "tokens": {
 *       "$STYLE_WALL":  { "block": "minecraft:brick_block" },
 *       "$STYLE_FLOOR": { "block": "minecraft:planks", "state": { "wood_type": "dark_oak" } }
 *     }
 *   }
 *
 * Resolution happens on the way to `.mcstructure`; the module itself stays
 * platform- and style-neutral.
 */

export const TOKEN_PATTERN = /^\$[A-Z0-9_]+$/

export function isToken(name) {
    return typeof name === 'string' && name.startsWith('$')
}

/** Every distinct token referenced by a module's blocks. */
export function tokensUsed(module) {
    const tokens = new Set()
    for (const block of module.blocks ?? []) {
        if (isToken(block.block)) tokens.add(block.block)
        if (block.extra && isToken(block.extra.block)) tokens.add(block.extra.block)
    }
    return tokens
}

export function validateStyle(style) {
    const errors = []
    if (!style || typeof style !== 'object') return ['style must be an object']
    if (!style.id) errors.push('style: missing "id"')
    if (!style.tokens || typeof style.tokens !== 'object') {
        errors.push('style: missing "tokens" object')
        return errors
    }
    for (const [token, binding] of Object.entries(style.tokens)) {
        if (!TOKEN_PATTERN.test(token)) {
            errors.push(`style "${style.id}": token "${token}" must match $UPPER_SNAKE_CASE`)
        }
        const block = typeof binding === 'string' ? binding : binding?.block
        if (typeof block !== 'string' || !block) {
            errors.push(`style "${style.id}": token "${token}" must bind to a block name`)
        } else if (isToken(block)) {
            errors.push(`style "${style.id}": token "${token}" binds to another token ("${block}")`)
        }
    }
    return errors
}

/**
 * Resolve one `{ block, state }` pair against a style.
 * Concrete block names pass through untouched, so modules may mix both.
 *
 * A block's own state is merged over the style binding's state, letting a
 * module say "the style's wall material, but upside down".
 */
export function resolveBlock(name, state = {}, style) {
    if (!isToken(name)) return { name, state }

    const binding = style?.tokens?.[name]
    if (binding === undefined) {
        throw new Error(`unresolved palette token "${name}"${style?.id ? ` in style "${style.id}"` : ' (no style supplied)'}`)
    }
    if (typeof binding === 'string') return { name: binding, state }
    return { name: binding.block, state: { ...(binding.state ?? {}), ...state } }
}

/** Which of a module's tokens the style cannot bind. */
export function missingTokens(module, style) {
    const bound = new Set(Object.keys(style?.tokens ?? {}))
    return [...tokensUsed(module)].filter((token) => !bound.has(token)).sort()
}
