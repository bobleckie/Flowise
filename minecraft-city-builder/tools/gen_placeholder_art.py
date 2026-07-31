#!/usr/bin/env python3
"""Generate the M0 placeholder art (item icon + pack icons) with no image deps.

These are stand-ins. Replace the PNGs directly once real art exists; nothing in
the pipeline reads this script at build time.

Usage: python3 tools/gen_placeholder_art.py
"""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "city_builder_bp")
RP = os.path.join(ROOT, "packs", "city_builder_rp")

CLEAR = (0, 0, 0, 0)


def write_png(path, pixels):
    """pixels: list of rows, each a list of (r, g, b, a) tuples."""
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(b"\x00" + b"".join(struct.pack("BBBB", *px) for px in row) for row in pixels)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(png)
    print(f"wrote {os.path.relpath(path, ROOT)} ({width}x{height})")


def blank(width, height, fill=CLEAR):
    return [[fill for _ in range(width)] for _ in range(height)]


def build_wand_icon():
    """16x16 wand: dark shaft running lower-left to upper-right, amber tip."""
    px = blank(16, 16)
    shaft_dark = (74, 52, 38, 255)
    shaft_light = (110, 80, 58, 255)
    tip_core = (255, 236, 168, 255)
    tip_mid = (247, 190, 62, 255)
    tip_edge = (176, 120, 24, 255)

    # Shaft: 9 steps of a 45-degree run, two pixels thick.
    for step in range(9):
        x, y = 2 + step, 13 - step
        px[y][x] = shaft_light
        if y + 1 < 16:
            px[y + 1][x] = shaft_dark

    # Tip: a small diamond around (12, 3).
    cx, cy = 12, 3
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            dist = abs(dx) + abs(dy)
            x, y = cx + dx, cy + dy
            if not (0 <= x < 16 and 0 <= y < 16):
                continue
            if dist == 0:
                px[y][x] = tip_core
            elif dist == 1:
                px[y][x] = tip_mid
            elif dist == 2:
                px[y][x] = tip_edge

    return px


def pack_icon(accent):
    """128x128 skyline over a dark ground plane."""
    size = 128
    sky_top = (24, 30, 46, 255)
    sky_bottom = (52, 62, 88, 255)
    ground = (18, 20, 28, 255)
    horizon = 104

    px = blank(size, size)
    for y in range(size):
        if y >= horizon:
            row_color = ground
        else:
            t = y / horizon
            row_color = tuple(
                int(sky_top[i] + (sky_bottom[i] - sky_top[i]) * t) for i in range(3)
            ) + (255,)
        for x in range(size):
            px[y][x] = row_color

    # (x, width, height) towers, drawn back to front.
    towers = [
        (6, 18, 44), (26, 14, 66), (42, 20, 52), (64, 16, 80),
        (82, 22, 58), (106, 16, 38),
    ]
    body = (86, 96, 118, 255)
    edge = (120, 132, 158, 255)

    for tx, tw, th in towers:
        top = horizon - th
        for y in range(top, horizon):
            for x in range(tx, min(tx + tw, size)):
                px[y][x] = edge if (x == tx or y == top) else body

        # Lit windows on a 4-block rhythm.
        for wy in range(top + 4, horizon - 3, 8):
            for wx in range(tx + 3, tx + tw - 2, 6):
                for dy in range(3):
                    for dx in range(3):
                        y, x = wy + dy, wx + dx
                        if top < y < horizon and tx < x < tx + tw - 1:
                            px[y][x] = accent

    return px


if __name__ == "__main__":
    write_png(os.path.join(RP, "textures", "items", "build_wand.png"), build_wand_icon())
    write_png(os.path.join(BP, "pack_icon.png"), pack_icon((247, 190, 62, 255)))
    write_png(os.path.join(RP, "pack_icon.png"), pack_icon((126, 208, 244, 255)))
