#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "src-tauri" / "icons" / "menubar-template.png"
RGBA_PATH = ROOT / "src-tauri" / "icons" / "menubar-template.rgba"
SIZE = 22


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    color = (255, 255, 255, 255)
    draw.rectangle((5, 3, 8, 18), fill=color)
    draw.rectangle((8, 3, 15, 6), fill=color)
    draw.rectangle((8, 9, 15, 12), fill=color)
    draw.rectangle((14, 6, 17, 9), fill=color)

    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(PNG_PATH)
    RGBA_PATH.write_bytes(image.tobytes())


if __name__ == "__main__":
    main()
