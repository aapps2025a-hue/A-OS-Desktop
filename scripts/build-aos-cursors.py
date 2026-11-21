#!/usr/bin/env python3
"""Build transparent, browser-safe A-OS cursors from the original PNG artwork."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops


CURSORS = {
    "Cursor.png": "cursor.png",
    "Text cursor.png": "text.png",
    "Hand.png": "hand.png",
    "Working.png": "wait.png",
    "App working in backgound.png": "progress.png",
    "Blocked.png": "not-allowed.png",
    "Vertical resize.png": "ns-resize.png",
    "Horizontal resize.png": "ew-resize.png",
    "Diagonal resize 1.png": "nesw-resize.png",
    "Diagonal resize 2.png": "nwse-resize.png",
    "Move.png": "move.png",
    "Precision select.png": "crosshair.png",
    "Pen_Brush.png": "pen.png",
}


def resize_premultiplied(image: Image.Image, alpha: Image.Image, size: int) -> Image.Image:
    channels = image.split()
    premultiplied = [ImageChops.multiply(channel, alpha) for channel in channels]
    output_alpha = alpha.resize((size, size), Image.Resampling.LANCZOS)
    resized_channels = [channel.resize((size, size), Image.Resampling.LANCZOS) for channel in premultiplied]

    rgba = Image.new("RGBA", (size, size))
    source_pixels = [channel.load() for channel in resized_channels]
    alpha_pixels = output_alpha.load()
    output_pixels = rgba.load()
    for y in range(size):
        for x in range(size):
            a = alpha_pixels[x, y]
            if a <= 0:
                output_pixels[x, y] = (0, 0, 0, 0)
                continue
            rgb = tuple(min(255, round(source_pixels[index][x, y] * 255 / a)) for index in range(3))
            output_pixels[x, y] = (*rgb, a)
    return rgba


def build_cursor(source: Path, destination: Path, size: int) -> None:
    image = Image.open(source).convert("RGB")
    red, green, blue = image.split()
    minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
    alpha = minimum.point(lambda value: 0 if value >= 248 else 255)
    output = resize_premultiplied(image, alpha, size)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Folder containing the original cursor PNGs")
    parser.add_argument("output", type=Path, help="Destination folder for transparent cursors")
    parser.add_argument("--size", type=int, default=64)
    args = parser.parse_args()

    missing = [name for name in CURSORS if not (args.source / name).is_file()]
    if missing:
        raise SystemExit("Missing cursor source files: " + ", ".join(missing))

    for source_name, output_name in CURSORS.items():
        destination = args.output / output_name
        build_cursor(args.source / source_name, destination, args.size)
        print(destination)


if __name__ == "__main__":
    main()
