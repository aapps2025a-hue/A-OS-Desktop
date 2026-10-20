from __future__ import annotations

import colorsys
import math
import shutil
import struct
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
ICONS = ASSETS / "icons"
BACKGROUNDS = ASSETS / "backgrounds"
MEDIA = ASSETS / "media"
CURSORS = ASSETS / "cursors"
OS_ASSETS = ASSETS / "os"

for folder in (ICONS, BACKGROUNDS, MEDIA, CURSORS, OS_ASSETS):
    folder.mkdir(parents=True, exist_ok=True)


ICON_NAMES = [
    "38.png", "AI Services (Hidden App).png", "aos.png", "Arrow Left.png",
    "Arrow Right.png", "Arrow Up.png", "Battery.png", "0 battery  Charging.png",
    "0 battery.png", "Full Battery  Charging.png", "Full Battery.png",
    "Half Battery Charging.png", "Half Battery.png", "Low Battery Charging.png",
    "Low Battery.png", "Mostly Full Battery (2).png", "Mostly Full Battery.png",
    "Bug.png", "Bugged.png", "Calculator.png", "Clock.png", "Cloud.png",
    "Code.png", "Company.png", "Cross.png", "css.png",
    "Dead A Screen (bsod but das).png", "Downloads.png", "Draw.png", "Error.png",
    "Files.png", "html.png", "Image.png", "Images.png", "Internet.png", "js.png",
    "Less.png", "Lucky.png", "lock.png", "Media Files.png", "More.png",
    "Money.png", "Music.png", "Notes.png", "OS Logo.png", "PC.png",
    "Profile.png", "Reboot.png", "Record.png", "Safe.png",
    "Security Shield Assistant.png", "Security Shield.png", "Settings.png",
    "Shutdown.png", "splash.png", "STAR.png", "Success.png", "Terminal.png",
    "terminalcmd.png", "Text Editor.png", "This PC.png", "Tick.png", "Trash.png",
    "Unnamed app.png", "UnSafe.png", "Video.png", "Weather.png", "zip.png",
    "tma.png",
]

BACKGROUND_NAMES = [
    "Default A.gif", "A-OS, it is it.gif", "A-OS 1.0 (A-OS Flower).gif",
    "Aqua A (Default).png", "Aqua A (No A).png", "Aqua A (Remix).png",
    "Blackish Blue.png", "Dark Blue.png", "Faro.jpg", "Flowers.png", "Leafs.png",
    "Light Blue.png", "Orange Shapes.png", "Porto.png", "Portugual.png", "Rain.png",
    "Rainy Day.png", "Scotland.png", "Sun.png", "Sunny Day.png",
]

MEDIA_NAMES = [
    "startupsound-modern.wav", "Startup - Aurora.wav", "Startup - Blue Horizon.wav",
    "Startup - Crystal Rise.wav", "Startup - Daybreak.wav", "Startup - Digital Bloom.wav",
    "Startup - Orbit Wake.wav", "Startup - Soft Glass.wav", "Startup - Starlight.wav",
    "Startup - Welcome Home.wav", "Ringtone - Azure Bell.wav", "Ringtone - Comet.wav",
    "Ringtone - Echo Pulse.wav", "Ringtone - Metro.wav", "Ringtone - Moonline.wav",
    "Ringtone - Signal.wav", "Ringtone - Skylight.wav", "Ringtone - Waveform.wav",
    "Ringtone - Zenith.wav",
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(width):
            pixels[x, y] = color
    return image


def logo(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color=(255, 255, 255, 255)) -> None:
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    points = [
        (x0 + width * .50, y0 + height * .06),
        (x0 + width * .90, y0 + height * .92),
        (x0 + width * .68, y0 + height * .92),
        (x0 + width * .58, y0 + height * .67),
        (x0 + width * .42, y0 + height * .67),
        (x0 + width * .32, y0 + height * .92),
        (x0 + width * .10, y0 + height * .92),
    ]
    draw.polygon(points, fill=color)
    draw.polygon([
        (x0 + width * .50, y0 + height * .35),
        (x0 + width * .42, y0 + height * .58),
        (x0 + width * .58, y0 + height * .58),
    ], fill=(16, 89, 170, 255))


def rounded_tile(name: str, color: tuple[int, int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((12, 12, 244, 244), radius=52, fill=(*color, 255))
    return image, draw


def battery_icon(name: str) -> Image.Image:
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    charging = "charging" in name.lower()
    if name.lower().startswith("0 battery"):
        level, color = 0.03, (255, 78, 82, 255)
    elif name.lower().startswith("low"):
        level, color = .25, (145, 145, 150, 255)
    elif name.lower().startswith("half"):
        level, color = .52, (145, 145, 150, 255)
    elif name.lower().startswith("mostly"):
        level, color = .76, (145, 145, 150, 255)
    else:
        level, color = 1.0, (145, 145, 150, 255)
    if charging:
        color = (119, 216, 74, 255)
    draw.rounded_rectangle((22, 68, 214, 188), radius=24, outline=color, width=13)
    draw.rounded_rectangle((220, 103, 242, 153), radius=8, fill=color)
    inset = (38, 84, 198, 172)
    fill_width = int((inset[2] - inset[0]) * level)
    if fill_width:
        draw.rounded_rectangle((inset[0], inset[1], inset[0] + fill_width, inset[3]), radius=13, fill=color)
    if charging:
        draw.line((137, 79, 104, 133, 133, 133, 103, 181), fill=(16, 16, 18, 255), width=9, joint="curve")
    return image


def create_icon(name: str) -> Image.Image:
    lower = name.lower()
    if "battery" in lower:
        return battery_icon(name)
    if lower == "cloud.png":
        image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        d = ImageDraw.Draw(image)
        d.ellipse((38, 110, 138, 204), fill=(211, 217, 225, 255))
        d.ellipse((72, 56, 182, 190), fill=(211, 217, 225, 255))
        d.ellipse((129, 93, 226, 201), fill=(211, 217, 225, 255))
        d.rounded_rectangle((58, 130, 208, 203), radius=30, fill=(211, 217, 225, 255))
        return image

    palette = {
        "system": (24, 126, 208), "file": (241, 172, 48), "media": (215, 64, 128),
        "safe": (34, 161, 104), "danger": (221, 68, 72), "code": (45, 112, 220),
        "utility": (91, 107, 128), "weather": (36, 161, 218), "purple": (119, 82, 208),
    }
    group = "utility"
    if any(word in lower for word in ("os ", "aos", "splash", "logo")): group = "system"
    if any(word in lower for word in ("file", "download", "zip", "notes", "text")): group = "file"
    if any(word in lower for word in ("music", "video", "record", "image", "media")): group = "media"
    if any(word in lower for word in ("safe", "security", "tick", "success")): group = "safe"
    if any(word in lower for word in ("error", "bug", "cross", "shutdown", "dead")): group = "danger"
    if any(word in lower for word in ("code", "html", "css", "js", "terminal")): group = "code"
    if "weather" in lower or "sun" in lower: group = "weather"
    if any(word in lower for word in ("ai ", "lucky", "star")): group = "purple"
    image, draw = rounded_tile(name, palette[group])
    white = (255, 255, 255, 245)

    if any(word in lower for word in ("os logo", "aos.png", "splash")):
        logo(draw, (62, 43, 194, 209), white)
    elif "file" in lower or "download" in lower:
        draw.rounded_rectangle((48, 86, 208, 192), radius=18, fill=white)
        draw.polygon(((48, 97), (48, 72), (105, 72), (126, 97)), fill=white)
        if "download" in lower:
            draw.line((128, 105, 128, 158), fill=palette[group], width=13)
            draw.polygon(((101, 143), (155, 143), (128, 173)), fill=palette[group])
    elif "internet" in lower:
        draw.ellipse((54, 54, 202, 202), outline=white, width=11)
        draw.ellipse((93, 54, 163, 202), outline=white, width=8)
        draw.line((55, 128, 201, 128), fill=white, width=8)
    elif "pc" in lower or "computer" in lower:
        draw.rounded_rectangle((42, 55, 214, 165), radius=14, fill=white)
        draw.rounded_rectangle((54, 67, 202, 153), radius=6, fill=(26, 53, 79, 255))
        draw.polygon(((103, 165), (153, 165), (170, 202), (86, 202)), fill=white)
    elif "settings" in lower:
        draw.ellipse((69, 69, 187, 187), outline=white, width=19)
        draw.ellipse((108, 108, 148, 148), fill=white)
        for angle in range(0, 360, 45):
            r = math.radians(angle)
            draw.line((128 + 64 * math.cos(r), 128 + 64 * math.sin(r), 128 + 90 * math.cos(r), 128 + 90 * math.sin(r)), fill=white, width=17)
    elif "clock" in lower:
        draw.ellipse((49, 49, 207, 207), fill=white)
        draw.line((128, 128, 128, 79), fill=palette[group], width=12)
        draw.line((128, 128, 169, 128), fill=palette[group], width=10)
    elif "weather" in lower:
        draw.ellipse((48, 48, 126, 126), fill=(255, 211, 60, 255))
        draw.ellipse((61, 116, 139, 190), fill=white)
        draw.ellipse((101, 87, 180, 190), fill=white)
        draw.ellipse((141, 116, 211, 190), fill=white)
        draw.rounded_rectangle((70, 139, 202, 192), radius=24, fill=white)
    elif any(word in lower for word in ("security", "safe", "unsafe")):
        draw.polygon(((128, 42), (200, 71), (191, 164), (128, 213), (65, 164), (56, 71)), fill=white)
        if "unsafe" in lower:
            draw.line((99, 101, 158, 160), fill=palette[group], width=13)
            draw.line((158, 101, 99, 160), fill=palette[group], width=13)
        else:
            draw.line((91, 128, 117, 154, 167, 96), fill=palette[group], width=13, joint="curve")
    elif "terminal" in lower:
        draw.line((61, 82, 113, 128, 61, 174), fill=white, width=14, joint="curve")
        draw.line((127, 176, 195, 176), fill=white, width=13)
    elif "code" in lower or lower in {"html.png", "css.png", "js.png"}:
        draw.line((95, 78, 53, 128, 95, 178), fill=white, width=13, joint="curve")
        draw.line((161, 78, 203, 128, 161, 178), fill=white, width=13, joint="curve")
        draw.line((145, 56, 111, 200), fill=white, width=11)
    elif any(word in lower for word in ("music", "media")):
        draw.ellipse((76, 156, 125, 203), fill=white)
        draw.ellipse((151, 142, 200, 189), fill=white)
        draw.line((117, 80, 117, 177), fill=white, width=13)
        draw.line((192, 64, 192, 163), fill=white, width=13)
        draw.line((117, 80, 192, 64), fill=white, width=13)
    elif "video" in lower or "record" in lower:
        draw.ellipse((60, 60, 196, 196), fill=white)
        draw.polygon(((111, 91), (111, 165), (171, 128)), fill=palette[group])
    elif "image" in lower:
        draw.rounded_rectangle((49, 57, 207, 199), radius=19, fill=white)
        draw.ellipse((70, 77, 104, 111), fill=(255, 201, 46, 255))
        draw.polygon(((63, 181), (112, 126), (143, 157), (165, 132), (198, 181)), fill=palette[group])
    elif "calculator" in lower:
        draw.rounded_rectangle((67, 43, 189, 213), radius=20, fill=white)
        draw.rounded_rectangle((82, 61, 174, 99), radius=8, fill=(35, 53, 73, 255))
        for row in range(3):
            for col in range(3):
                draw.ellipse((84 + col * 34, 119 + row * 27, 99 + col * 34, 134 + row * 27), fill=palette[group])
    elif "trash" in lower:
        draw.rounded_rectangle((78, 78, 178, 207), radius=13, fill=white)
        draw.rounded_rectangle((65, 57, 191, 75), radius=9, fill=white)
        draw.rounded_rectangle((105, 43, 151, 61), radius=9, fill=white)
    elif "profile" in lower or "company" in lower:
        draw.ellipse((91, 55, 165, 129), fill=white)
        draw.pieslice((58, 117, 198, 240), 180, 360, fill=white)
    elif "cross" in lower or "error" in lower or "bugged" in lower:
        draw.line((75, 75, 181, 181), fill=white, width=19)
        draw.line((181, 75, 75, 181), fill=white, width=19)
    elif "tick" in lower or "success" in lower:
        draw.line((66, 128, 109, 171, 190, 79), fill=white, width=20, joint="curve")
    elif "reboot" in lower:
        draw.arc((58, 58, 198, 198), 38, 325, fill=white, width=16)
        draw.polygon(((177, 48), (205, 83), (162, 88)), fill=white)
    elif "shutdown" in lower:
        draw.arc((57, 57, 199, 205), -45, 225, fill=white, width=17)
        draw.line((128, 42, 128, 129), fill=white, width=18)
    elif "arrow left" in lower or "arrow right" in lower or "arrow up" in lower:
        if "left" in lower: points = ((174, 57), (91, 128), (174, 199))
        elif "right" in lower: points = ((82, 57), (165, 128), (82, 199))
        else: points = ((57, 174), (128, 91), (199, 174))
        draw.line(points, fill=white, width=18, joint="curve")
    elif lower == "tma.png":
        for index, height in enumerate((44, 82, 121, 72)):
            x = 55 + index * 39
            draw.rounded_rectangle((x, 195 - height, x + 25, 195), radius=7, fill=white)
    else:
        label = Path(name).stem[:2].upper()
        box = draw.textbbox((0, 0), label, font=font(76, True))
        draw.text(((256 - (box[2] - box[0])) / 2, (256 - (box[3] - box[1])) / 2 - 8), label, fill=white, font=font(76, True))
    return image


def save_icon(name: str) -> None:
    path = ICONS / name
    if path.exists():
        return
    create_icon(name).save(path, optimize=True)


def scenic_background(name: str) -> Image.Image:
    key = name.lower()
    if any(word in key for word in ("dark", "blackish")):
        image = gradient((1600, 900), (5, 19, 37), (11, 61, 88))
    elif "orange" in key:
        image = gradient((1600, 900), (255, 188, 89), (227, 77, 45))
    elif "rain" in key:
        image = gradient((1600, 900), (43, 68, 92), (99, 124, 144))
    elif "scotland" in key:
        image = gradient((1600, 900), (100, 155, 188), (216, 229, 221))
    elif any(word in key for word in ("porto", "portugual", "faro")):
        image = gradient((1600, 900), (51, 173, 225), (255, 207, 112))
    else:
        image = gradient((1600, 900), (19, 148, 220), (20, 56, 127))
    draw = ImageDraw.Draw(image, "RGBA")
    if any(word in key for word in ("porto", "portugual", "faro", "scotland")):
        draw.rectangle((0, 610, 1600, 900), fill=(18, 107, 135, 210))
        for x in range(-80, 1720, 180):
            height = 140 + (x // 180 % 4) * 34
            draw.rectangle((x, 610 - height, x + 140, 610), fill=(34, 92, 80, 230))
            draw.polygon(((x - 12, 610 - height), (x + 70, 535 - height), (x + 152, 610 - height)), fill=(207, 104, 58, 240))
        if "porto" in key:
            draw.arc((260, 235, 1340, 950), 190, 350, fill=(42, 56, 67, 255), width=28)
    elif "rain" in key:
        for x in range(20, 1600, 58):
            offset = (x * 17) % 130
            draw.line((x, 80 + offset, x - 38, 235 + offset), fill=(194, 229, 245, 100), width=5)
    elif any(word in key for word in ("flower", "leaf")):
        for idx in range(48):
            x = (idx * 179) % 1600
            y = 250 + (idx * 97) % 620
            color = (78, 190, 129, 210) if "leaf" in key else (255, 171 + idx % 70, 207, 200)
            draw.ellipse((x - 35, y - 18, x + 35, y + 18), fill=color)
    elif "sun" in key:
        draw.ellipse((1050, 105, 1390, 445), fill=(255, 221, 90, 230))
    else:
        for idx in range(7):
            draw.ellipse((100 + idx * 230, 90 + idx % 3 * 160, 600 + idx * 230, 570 + idx % 3 * 160), fill=(255, 255, 255, 18))
    return image


def save_background(name: str) -> None:
    path = BACKGROUNDS / name
    if path.exists():
        return
    image = scenic_background(name).convert("RGB")
    if path.suffix.lower() == ".gif":
        frames = []
        for frame_index in range(18):
            frame = image.copy()
            draw = ImageDraw.Draw(frame, "RGBA")
            phase = frame_index / 18 * math.tau
            for ring_index in range(4):
                radius = 90 + ring_index * 70 + 20 * math.sin(phase + ring_index)
                draw.ellipse((800 - radius, 450 - radius, 800 + radius, 450 + radius), outline=(160, 235, 255, 65), width=8)
            logo(draw, (680, 290, 920, 620), (255, 255, 255, 230))
            frames.append(frame.quantize(colors=128))
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=90, loop=0, optimize=True)
    else:
        image.save(path, quality=90 if path.suffix.lower() == ".jpg" else None, optimize=True)


def save_tone(name: str, index: int) -> None:
    path = MEDIA / name
    if path.exists():
        return
    rate = 22050
    startup = name.lower().startswith("startup") or name == "startupsound-modern.wav"
    duration = 1.35 if startup else .85
    base = 280 + (index % 8) * 42
    notes = (1.0, 1.25, 1.5) if startup else (1.0, 1.5)
    samples = []
    for sample_index in range(int(rate * duration)):
        t = sample_index / rate
        envelope = min(1.0, t * 12) * max(0.0, 1 - t / duration) ** 1.7
        value = 0.0
        for note_index, ratio in enumerate(notes):
            delay = note_index * (.18 if startup else .12)
            if t >= delay:
                value += math.sin(math.tau * base * ratio * (t - delay)) * (0.55 / (note_index + 1))
        samples.append(int(max(-1, min(1, value * envelope)) * 32760))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(struct.pack("<" + "h" * len(samples), *samples))


def save_boot_gif() -> None:
    path = OS_ASSETS / "A-OS Boot.gif"
    if path.exists():
        return
    frames = []
    for frame_index in range(54):
        width, height = 960, 540
        image = gradient((width, height), (3, 14, 27), (6, 43, 68)).convert("RGBA")
        draw = ImageDraw.Draw(image, "RGBA")
        phase = frame_index / 54
        for ring_index in range(5):
            radius = 116 + ring_index * 32 + math.sin(phase * math.tau + ring_index) * 6
            alpha = 72 - ring_index * 11
            draw.arc((width / 2 - radius, height / 2 - radius - 22, width / 2 + radius, height / 2 + radius - 22), frame_index * 9 + ring_index * 38, frame_index * 9 + 245 + ring_index * 38, fill=(76, 211, 239, alpha), width=5)
        draw.rounded_rectangle((390, 144, 570, 324), radius=42, fill=(23, 132, 208, 255), outline=(112, 227, 247, 180), width=3)
        logo(draw, (424, 170, 536, 300), (255, 255, 255, 255))
        title_font = font(34, True)
        subtitle_font = font(16, False)
        title = "A-OS"
        title_box = draw.textbbox((0, 0), title, font=title_font)
        draw.text(((width - (title_box[2] - title_box[0])) / 2, 345), title, font=title_font, fill=(245, 251, 255, 255))
        subtitle = "Starting your computer"
        subtitle_box = draw.textbbox((0, 0), subtitle, font=subtitle_font)
        draw.text(((width - (subtitle_box[2] - subtitle_box[0])) / 2, 392), subtitle, font=subtitle_font, fill=(166, 198, 218, 255))
        draw.rounded_rectangle((316, 436, 644, 444), radius=4, fill=(255, 255, 255, 28))
        progress = 328 * min(1.0, (frame_index + 1) / 50)
        draw.rounded_rectangle((316, 436, 316 + progress, 444), radius=4, fill=(74, 212, 239, 255))
        frames.append(image.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=60, disposal=2, optimize=True)


def save_boot_splash() -> None:
    width, height = 1152, 648
    image = Image.new("RGB", (width, height), (2, 3, 5))
    draw = ImageDraw.Draw(image, "RGBA")
    tile = (width // 2 - 112, 112, width // 2 + 112, 336)
    draw.rounded_rectangle(tile, radius=48, fill=(22, 126, 208, 255), outline=(102, 213, 239, 190), width=4)
    logo(draw, (width // 2 - 68, 145, width // 2 + 68, 305), (255, 255, 255, 255))
    title = "A-OS"
    title_font = font(62, True)
    title_box = draw.textbbox((0, 0), title, font=title_font)
    draw.text(((width - (title_box[2] - title_box[0])) / 2, 382), title, font=title_font, fill=(255, 255, 255, 255))
    subtitle = "Desktop"
    subtitle_font = font(24, False)
    subtitle_box = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    draw.text(((width - (subtitle_box[2] - subtitle_box[0])) / 2, 466), subtitle, font=subtitle_font, fill=(164, 194, 217, 255))

    destinations = [
        ICONS / "splash.png",
        ROOT / "iso" / "config" / "includes.chroot" / "usr" / "share" / "plymouth" / "themes" / "aos" / "aos-boot.png",
        ROOT / "iso" / "config" / "bootloaders" / "grub-pc" / "splash.png",
    ]
    for destination in destinations:
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, optimize=True)


for icon_name in ICON_NAMES:
    save_icon(icon_name)

for background_name in BACKGROUND_NAMES:
    save_background(background_name)

for media_index, media_name in enumerate(MEDIA_NAMES):
    save_tone(media_name, media_index)

legacy_sound = ICONS / "s9_over_the_horizon.mp3"
if legacy_sound.exists() and not (MEDIA / legacy_sound.name).exists():
    shutil.copy2(legacy_sound, MEDIA / legacy_sound.name)

save_boot_gif()
save_boot_splash()

print(f"icons={len(list(ICONS.iterdir()))} backgrounds={len(list(BACKGROUNDS.iterdir()))} media={len(list(MEDIA.iterdir()))}")
