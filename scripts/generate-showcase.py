#!/usr/bin/env python3

from functools import lru_cache
from pathlib import Path
import math
import os
import subprocess
import wave

from PIL import Image, ImageDraw, ImageEnhance, ImageFont
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT_DIR = PUBLIC / "assets" / "video"
VIDEO = OUT_DIR / "A-OS-Desktop-Showcase.mp4"
POSTER = OUT_DIR / "A-OS-Desktop-Showcase.jpg"
W, H, FPS = 1280, 720, 30
TRANSITION = 0.56


def get_font(size, bold=False):
    filename = "segoeuib.ttf" if bold else "segoeui.ttf"
    options = [
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / filename,
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for path in options:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


F12, F14, F16, F18, F20, F22, F24 = (get_font(size) for size in (12, 14, 16, 18, 20, 22, 24))
F16B, F18B, F20B, F24B = (get_font(size, True) for size in (16, 18, 20, 24))
F28, F34, F42, F52, F64, F78, F92 = (get_font(size, True) for size in (28, 34, 42, 52, 64, 78, 92))


def asset(folder, name):
    return PUBLIC / "assets" / folder / name


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smooth(value):
    value = clamp(value)
    return value * value * (3 - 2 * value)


def ease_out(value):
    value = clamp(value)
    return 1 - (1 - value) ** 5


def ease_in_out(value):
    value = clamp(value)
    return value ** 3 * (value * (value * 6 - 15) + 10)


def out_back(value):
    value = clamp(value)
    return 1 + 2.70158 * (value - 1) ** 3 + 1.70158 * (value - 1) ** 2


def lerp(start, end, value):
    return start + (end - start) * value


def lerp_box(start, end, value):
    return tuple(round(lerp(a, b, value)) for a, b in zip(start, end))


def alpha(value):
    return round(clamp(value) * 255)


def camera_frame(base, zoom=1, center=(W / 2, H / 2)):
    if zoom <= 1.0001:
        return base
    crop_w, crop_h = W / zoom, H / zoom
    cx, cy = center
    left = clamp(cx - crop_w / 2, 0, W - crop_w)
    top = clamp(cy - crop_h / 2, 0, H - crop_h)
    box = (round(left), round(top), round(left + crop_w), round(top + crop_h))
    return base.crop(box).resize((W, H), Image.Resampling.LANCZOS)


def rounded_icon(base, name, x, y, size, radius=28, opacity=1):
    icon = cached_icon(name, size).copy()
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=alpha(opacity))
    icon.putalpha(Image.composite(icon.getchannel("A"), Image.new("L", (size, size), 0), mask))
    base.alpha_composite(icon, (round(x), round(y)))


@lru_cache(maxsize=24)
def background(name, dim=0):
    image = Image.open(asset("backgrounds", name)).convert("RGB")
    scale = max(W / image.width, H / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left, top = (image.width - W) // 2, (image.height - H) // 2
    image = image.crop((left, top, left + W, top + H))
    if dim:
        image = Image.blend(image, Image.new("RGB", (W, H), "#061019"), dim / 100)
    return image.convert("RGBA")


@lru_cache(maxsize=128)
def cached_icon(name, size):
    image = Image.open(asset("icons", name)).convert("RGBA")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
    return output


def put_icon(base, name, x, y, size, opacity=1):
    image = cached_icon(name, size)
    if opacity < 1:
        image = image.copy()
        image.putalpha(image.getchannel("A").point(lambda value: round(value * opacity)))
    base.alpha_composite(image, (round(x), round(y)))


def rounded_panel(draw, box, radius=10, fill=(246, 250, 252, 244), outline=(255, 255, 255, 170), width=1):
    draw.rounded_rectangle(tuple(round(v) for v in box), radius=radius, fill=fill, outline=outline, width=width)


def shadow_box(base, box, radius=12, fill=(246, 250, 252, 250), outline=(185, 204, 215, 230)):
    draw = ImageDraw.Draw(base, "RGBA")
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 8, y1 + 10, x2 + 8, y2 + 10), radius=radius, fill=(0, 0, 0, 46))
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def scene_label(base, eyebrow, title, progress):
    p = ease_out(progress)
    x = round(44 - 460 * (1 - p))
    draw = ImageDraw.Draw(base, "RGBA")
    title_width = draw.textbbox((0, 0), title, font=F34)[2]
    width = max(470, title_width + 58)
    rounded_panel(draw, (x, 30, x + width, 126), 22, (5, 13, 20, 226), (255, 255, 255, 48))
    draw.text((x + 28, 45), eyebrow.upper(), font=F14, fill="#69daf7")
    draw.text((x + 28, 70), title, font=F34, fill="white")


def chapter_scene(headline, detail, accent="#42c8ed", icon_name="OS Logo.png"):
    def render_chapter(t, duration):
        base = Image.new("RGBA", (W, H), "#030609")
        draw = ImageDraw.Draw(base, "RGBA")
        enter = ease_out(t / 0.62)
        leave = smooth((duration - t) / 0.38)
        visible = min(enter, leave)
        icon_size = round(lerp(196, 112, enter))
        icon_x = round(lerp(W / 2 - 98, 126, enter))
        icon_y = round(lerp(H / 2 - 98, H / 2 - 56, enter))
        rounded_icon(base, icon_name, icon_x, icon_y, icon_size, max(20, icon_size // 5), visible)
        text_x = round(lerp(W / 2, 296, enter))
        draw.text((text_x, 270), headline, font=F64, fill=(255, 255, 255, alpha(visible)), anchor="la")
        draw.text((text_x + 4, 356), detail, font=F22, fill=(163, 190, 203, alpha(visible)), anchor="la")
        line_end = lerp(text_x + 4, text_x + 374, smooth((t - 0.22) / 0.72))
        draw.rounded_rectangle((text_x + 4, 407, line_end, 414), radius=4, fill=accent)
        return base

    return render_chapter


def draw_cursor(base, x, y, click=0):
    draw = ImageDraw.Draw(base, "RGBA")
    x, y = round(x), round(y)
    if click > 0:
        radius = round(10 + 22 * click)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(63, 207, 244, alpha(1 - click)), width=3)
    points = [(x, y), (x + 2, y + 29), (x + 9, y + 21), (x + 17, y + 36), (x + 23, y + 33), (x + 15, y + 18), (x + 27, y + 17)]
    draw.polygon([(a + 2, b + 3) for a, b in points], fill=(0, 0, 0, 120))
    draw.polygon(points, fill="white", outline="#101820")


def taskbar(base, active=(), t=1, vertical=False):
    draw = ImageDraw.Draw(base, "RGBA")
    if vertical:
        x = round(10 - 92 * (1 - smooth(t)))
        rounded_panel(draw, (x, 12, x + 76, 708), 28, (224, 247, 251, 216), (255, 255, 255, 200))
        icons = [("OS Logo.png", "Start"), ("Files.png", "Files"), ("Internet.png", "Web"), ("Draw.png", "Paint"), ("Lucky.png", "Games")]
        for index, (name, label) in enumerate(icons):
            y = 32 + index * 92
            put_icon(base, name, x + 14, y, 48)
            if label in active:
                draw.rounded_rectangle((x + 68, y + 9, x + 72, y + 39), radius=2, fill="#21add9")
        draw.text((x + 38, 670), "12:45", font=F12, fill="#17313d", anchor="ma")
        return

    y = round(646 + 80 * (1 - smooth(t)))
    rounded_panel(draw, (16, y, 1264, y + 60), 24, (235, 249, 252, 222), (255, 255, 255, 210))
    put_icon(base, "OS Logo.png", 32, y + 8, 44)
    rounded_panel(draw, (86, y + 9, 302, y + 51), 19, (255, 255, 255, 184), (185, 211, 222, 180))
    draw.text((112, y + 19), "Search your device", font=F14, fill="#526a75")
    icons = [("Internet.png", "Web"), ("Files.png", "Files"), ("Downloads.png", "A-Store"), ("AI Services (Hidden App).png", "A-AI"), ("Draw.png", "Paint")]
    for index, (name, label) in enumerate(icons):
        x = 326 + index * 58
        put_icon(base, name, x, y + 9, 42)
        if label in active:
            draw.rounded_rectangle((x + 7, y + 53, x + 35, y + 56), radius=2, fill="#0a9dcc")
    put_icon(base, "Full Battery  Charging.png", 1110, y + 18, 28)
    draw.text((1190, y + 16), "12:45", font=F14, fill="#17313d", anchor="ma")
    draw.text((1190, y + 35), "14 Nov", font=F12, fill="#526a75", anchor="ma")


def desktop_icons(base, progress=1):
    draw = ImageDraw.Draw(base, "RGBA")
    items = [("This PC.png", "This PC"), ("Trash.png", "Trash"), ("Downloads.png", "A-Store")]
    for index, (name, label) in enumerate(items):
        p = out_back(clamp(progress * 1.6 - index * 0.22))
        x = round(32 - (1 - p) * 100)
        y = 36 + index * 112
        put_icon(base, name, x, y, 58, clamp(p))
        draw.text((x + 29, y + 62), label, font=F14, fill="white", stroke_width=2, stroke_fill=(0, 0, 0, 120), anchor="ma")


def window_frame(base, box, title, icon_name=None, accent="#27b8e3", close_only=False):
    x1, y1, x2, y2 = (round(v) for v in box)
    shadow_box(base, (x1, y1, x2, y2), 12)
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((x1, y1, x2, y1 + 48), radius=12, fill=(214, 226, 234, 250))
    draw.rectangle((x1, y1 + 28, x2, y1 + 48), fill=(214, 226, 234, 250))
    draw.rounded_rectangle((x1 + 12, y1 + 12, x1 + 18, y1 + 36), radius=3, fill=accent)
    if icon_name:
        put_icon(base, icon_name, x1 + 28, y1 + 8, 32)
        text_x = x1 + 66
    else:
        text_x = x1 + 30
    draw.text((text_x, y1 + 14), title, font=F16B, fill="#162d38")
    draw.text((x2 - 22, y1 + 11), "x", font=F20B, fill="#20333c", anchor="ma")
    if not close_only:
        draw.text((x2 - 56, y1 + 13), "[]", font=F14, fill="#36515e", anchor="ma")
        draw.text((x2 - 91, y1 + 12), "-", font=F20, fill="#36515e", anchor="ma")
    return x1 + 14, y1 + 58, x2 - 14, y2 - 14


def files_content(base, content, selected="Home"):
    x1, y1, x2, y2 = content
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((x1, y1, x1 + 150, y2), radius=8, fill="#e7f0f4")
    entries = [("Home", "This PC.png"), ("Desktop", "Files.png"), ("Downloads", "Downloads.png"), ("Pictures", "Images.png")]
    for index, (label, icon_name) in enumerate(entries):
        y = y1 + 18 + index * 48
        if label == selected:
            draw.rounded_rectangle((x1 + 8, y - 5, x1 + 140, y + 34), radius=7, fill="#ccebf4")
        put_icon(base, icon_name, x1 + 16, y, 26)
        draw.text((x1 + 52, y + 4), label, font=F14, fill="#203944")
    draw.text((x1 + 178, y1 + 8), selected, font=F24B, fill="#18313d")
    cards = [("Images.png", "Photos", "148 items"), ("Media Files.png", "Videos", "12 items"), ("ISO.png", "A-OS Desktop ISO", "1.40 GB"), ("zip.png", "Projects", "8 folders")]
    available = max(290, x2 - x1 - 180)
    card_w = min(176, (available - 24) // 2)
    for index, (icon_name, title, detail) in enumerate(cards):
        column, row = index % 2, index // 2
        x = x1 + 178 + column * (card_w + 14)
        y = y1 + 54 + row * 112
        draw.rounded_rectangle((x, y, x + card_w, y + 96), radius=7, fill="white", outline="#cad9e0")
        put_icon(base, icon_name, x + 12, y + 14, 54)
        draw.text((x + 74, y + 18), title, font=F14, fill="#1c3440")
        draw.text((x + 74, y + 44), detail, font=F12, fill="#718792")


def browser_content(base, content, progress=0.35):
    x1, y1, x2, y2 = content
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((x1, y1, x2, y1 + 38), radius=8, fill="#172734")
    draw.rounded_rectangle((x1 + 64, y1 + 6, x2 - 18, y1 + 32), radius=13, fill="#2b3d4a")
    draw.text((x1 + 84, y1 + 10), "youtube.com/watch/A-OS", font=F12, fill="#e7f2f5")
    video = (x1 + 18, y1 + 54, x2 - 18, y2 - 52)
    draw.rounded_rectangle(video, radius=8, fill="#071b28")
    vx1, vy1, vx2, vy2 = video
    draw.ellipse((vx1 + 42, vy1 + 30, vx1 + 210, vy1 + 198), fill="#17c2cf")
    draw.polygon([(vx1 + 172, vy1 + 42), (vx1 + 290, vy1 + 114), (vx1 + 172, vy1 + 186)], fill="#6c70ff")
    draw.text(((vx1 + vx2) // 2, vy1 + 56), "A-OS Desktop", font=F34, fill="white", anchor="ma")
    draw.text(((vx1 + vx2) // 2, vy1 + 104), "Everything works together.", font=F18, fill="#cbe6ef", anchor="ma")
    line_y = vy2 - 18
    draw.rounded_rectangle((vx1 + 14, line_y, vx2 - 14, line_y + 5), radius=2, fill="#465763")
    draw.rounded_rectangle((vx1 + 14, line_y, lerp(vx1 + 14, vx2 - 14, progress), line_y + 5), radius=2, fill="#ff3d4d")
    draw.text((x1 + 18, y2 - 36), "A-OS showcase", font=F14, fill="#1b313c")
    draw.text((x2 - 18, y2 - 36), "HD  |  Fullscreen", font=F12, fill="#57707c", anchor="ra")


def ai_content(base, content, phase=1):
    x1, y1, x2, y2 = content
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((x1 + 10, y1 + 8, x2 - 62, y1 + 62), radius=12, fill="#e6eef3")
    draw.text((x1 + 26, y1 + 23), "Plan a weekend in Porto", font=F14, fill="#233c47")
    if phase > 0.25:
        draw.rounded_rectangle((x1 + 58, y1 + 78, x2 - 10, y2 - 44), radius=12, fill="#d7f4fb")
        draw.text((x1 + 76, y1 + 94), "Here is a plan with riverside", font=F14, fill="#16465a")
        draw.text((x1 + 76, y1 + 119), "walks, food, maps and times.", font=F14, fill="#16465a")
        for index, width in enumerate((220, 184, 238)):
            draw.rounded_rectangle((x1 + 76, y1 + 154 + index * 19, x1 + 76 + width, y1 + 161 + index * 19), radius=3, fill="#83d8eb")
    draw.rounded_rectangle((x1 + 10, y2 - 32, x2 - 10, y2 - 5), radius=12, fill="white", outline="#bfd2dc")
    draw.text((x1 + 25, y2 - 26), "Ask A-AI...", font=F12, fill="#718690")


def store_content(base, content, install_phase):
    x1, y1, x2, y2 = content
    draw = ImageDraw.Draw(base, "RGBA")
    draw.text((x1 + 8, y1 + 4), "Featured apps", font=F24B, fill="#18313d")
    draw.text((x1 + 8, y1 + 38), "Made for A-OS", font=F14, fill="#6c838e")
    apps = [("Draw.png", "Paint"), ("AI Services (Hidden App).png", "A-AI"), ("Music.png", "Music"), ("Lucky.png", "Games")]
    width = (x2 - x1 - 38) // 4
    for index, (icon_name, label) in enumerate(apps):
        x = x1 + 8 + index * (width + 10)
        draw.rounded_rectangle((x, y1 + 78, x + width, y2 - 12), radius=8, fill="#edf4f7", outline="#c7d8e0")
        put_icon(base, icon_name, x + (width - 76) // 2, y1 + 96, 76)
        draw.text((x + width / 2, y1 + 181), label, font=F16B, fill="#19323e", anchor="ma")
        if index == 0:
            button = (x + 16, y1 + 216, x + width - 16, y1 + 250)
            if install_phase < 0.38:
                draw.rounded_rectangle(button, radius=16, fill="#169fc9")
                draw.text(((button[0] + button[2]) / 2, button[1] + 8), "Install", font=F14, fill="white", anchor="ma")
            elif install_phase < 0.8:
                draw.rounded_rectangle(button, radius=16, fill="#d6e4ea")
                fill_end = lerp(button[0], button[2], smooth((install_phase - 0.38) / 0.42))
                draw.rounded_rectangle((button[0], button[1], fill_end, button[3]), radius=16, fill="#42c7e8")
                draw.text(((button[0] + button[2]) / 2, button[1] + 8), "Installing", font=F14, fill="#163b48", anchor="ma")
            else:
                draw.rounded_rectangle(button, radius=16, fill="#21b37c")
                draw.text(((button[0] + button[2]) / 2, button[1] + 8), "Open", font=F14, fill="white", anchor="ma")
        else:
            draw.text((x + width / 2, y1 + 230), "Open", font=F14, fill="#1087aa", anchor="ma")


def paint_content(base, content, phase):
    x1, y1, x2, y2 = content
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((x1, y1, x1 + 54, y2), radius=7, fill="#e5eef2")
    colors = ["#1f2d38", "#0ebac7", "#526dff", "#ff4f70", "#ffd35a"]
    for index, color in enumerate(colors):
        draw.ellipse((x1 + 14, y1 + 16 + index * 40, x1 + 40, y1 + 42 + index * 40), fill=color, outline="white", width=2)
    canvas = (x1 + 66, y1, x2, y2)
    draw.rounded_rectangle(canvas, radius=7, fill="white", outline="#d0dce2")
    cx1, cy1, cx2, cy2 = canvas
    points = [(cx1 + 80, cy2 - 48), ((cx1 + cx2) // 2, cy1 + 38), (cx2 - 82, cy2 - 48), (cx2 - 132, cy2 - 48), ((cx1 + cx2) // 2 + 26, cy1 + 104), ((cx1 + cx2) // 2 - 26, cy1 + 104), (cx1 + 132, cy2 - 48)]
    visible = clamp(phase) * (len(points) - 1)
    palette = ["#16c2cb", "#546bff", "#7357dd", "#ff4f70", "#516bff", "#17bfc8"]
    for index, (start, end) in enumerate(zip(points, points[1:])):
        amount = clamp(visible - index)
        if amount > 0:
            partial = (lerp(start[0], end[0], amount), lerp(start[1], end[1], amount))
            draw.line((start, partial), fill=palette[index], width=18)


def quick_settings(base, progress, slider=0.68):
    p = out_back(progress)
    x1 = round(864 + 420 * (1 - p))
    x2, y1, y2 = x1 + 388, 72, 626
    shadow_box(base, (x1, y1, x2, y2), 14, (245, 250, 252, 250), (200, 217, 225, 230))
    draw = ImageDraw.Draw(base, "RGBA")
    draw.text((x1 + 28, y1 + 24), "Quick settings", font=F24B, fill="#17313d")
    toggles = [("Internet.png", "Wi-Fi", "Home Network"), ("System.png", "Bluetooth", "Headphones")]
    for index, (icon_name, title, detail) in enumerate(toggles):
        y = y1 + 76 + index * 82
        draw.rounded_rectangle((x1 + 22, y, x2 - 22, y + 66), radius=9, fill="#e7f2f6")
        put_icon(base, icon_name, x1 + 34, y + 10, 44)
        draw.text((x1 + 92, y + 10), title, font=F16B, fill="#18313d")
        draw.text((x1 + 92, y + 35), detail, font=F12, fill="#65808c")
        draw.rounded_rectangle((x2 - 90, y + 17, x2 - 34, y + 49), radius=16, fill="#27b9df")
        draw.ellipse((x2 - 62, y + 20, x2 - 38, y + 44), fill="white")
    for index, (label, value) in enumerate((("Volume", slider), ("Brightness", 0.82))):
        y = y1 + 264 + index * 82
        draw.text((x1 + 28, y), label, font=F14, fill="#3e5965")
        draw.rounded_rectangle((x1 + 28, y + 32, x2 - 28, y + 44), radius=6, fill="#c7d8df")
        end = lerp(x1 + 28, x2 - 28, value)
        draw.rounded_rectangle((x1 + 28, y + 32, end, y + 44), radius=6, fill="#20aed7")
        draw.ellipse((end - 9, y + 25, end + 9, y + 51), fill="white", outline="#20aed7")
    put_icon(base, "Full Battery  Charging.png", x1 + 28, y2 - 74, 46)
    draw.text((x1 + 90, y2 - 67), "86%", font=F18B, fill="#18313d")
    draw.text((x1 + 90, y2 - 43), "Charging", font=F12, fill="#65808c")


def toast(base, title, detail, icon_name, progress, y=96):
    p = out_back(progress)
    x2 = round(1244 + 380 * (1 - p))
    x1 = x2 - 356
    draw = ImageDraw.Draw(base, "RGBA")
    rounded_panel(draw, (x1, y, x2, y + 84), 10, (247, 251, 252, 244), (191, 209, 218, 220))
    put_icon(base, icon_name, x1 + 16, y + 16, 52)
    draw.text((x1 + 82, y + 17), title, font=F16B, fill="#17313d")
    draw.text((x1 + 82, y + 45), detail, font=F12, fill="#637d89")


def boot_scene(t, duration):
    base = Image.new("RGBA", (W, H), "#020405")
    draw = ImageDraw.Draw(base, "RGBA")
    p = ease_in_out(t / 1.35)
    size = round(lerp(510, 142, p))
    rounded_icon(base, "OS Logo.png", (W - size) / 2, lerp(104, 134, p), size, max(34, size // 5), 1)
    text_p = smooth((t - 0.92) / 0.72)
    draw.text((W / 2, 344), "This is A-OS Desktop.", font=F64, fill=(255, 255, 255, alpha(text_p)), anchor="ma")
    draw.text((W / 2, 430), "Your computer, reimagined around you.", font=F22, fill=(164, 194, 207, alpha(text_p)), anchor="ma")
    line_p = smooth((t - 1.16) / 1.1)
    draw.rounded_rectangle((454, 493, 826, 500), radius=4, fill="#17262e")
    draw.rounded_rectangle((454, 493, lerp(454, 826, line_p), 500), radius=4, fill="#42c9ed")
    if t > duration - 0.52:
        flash = smooth((t - duration + 0.52) / 0.52)
        base.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, alpha(flash))))
    return base


def files_scene(t, duration):
    base = background("Porto.png").copy()
    desktop_icons(base, clamp(t / 1.3))
    taskbar(base, active=("Files",), t=clamp(t / 0.75))
    scene_label(base, "A real desktop", "Open. Move. Organize.", clamp((t - 0.25) / 0.6))
    open_p = out_back(clamp((t - 1.0) / 0.65))
    box = lerp_box((378, 660, 424, 694), (236, 122, 1126, 616), open_p)
    if open_p > 0.18:
        content = window_frame(base, box, "Files", "Files.png")
        if open_p > 0.78:
            files_content(base, content)
    cursor_p = smooth((t - 0.25) / 1.0)
    cx, cy = lerp(700, 371, cursor_p), lerp(560, 665, cursor_p)
    if t > 1.0:
        drag = smooth((t - 3.15) / 1.15)
        cx, cy = lerp(371, 550, drag), lerp(665, 144, drag)
    click = clamp(1 - abs(t - 1.0) / 0.25) if t < 1.35 else clamp(1 - abs(t - 3.35) / 0.24)
    draw_cursor(base, cx, cy, click)
    return camera_frame(base, 1.055 - 0.035 * smooth(t / duration), (W / 2, H / 2 + 10))


def multitask_scene(t, duration):
    base = background("Aqua A (No A).png").copy()
    taskbar(base, active=("Files", "Web", "A-AI"), t=1)
    scene_label(base, "Multitasking", "Snap windows. Keep moving.", clamp(t / 0.55))
    files_content(base, window_frame(base, (30, 132, 624, 630), "Files", "Files.png"))
    web_p = out_back(clamp((t - 0.35) / 0.7))
    web_box = lerp_box((370, 664, 414, 696), (644, 132, 1250, 630), web_p)
    if web_p > 0.18:
        content = window_frame(base, web_box, "A-OS Internet", "Internet.png", "#36c9d1")
        if web_p > 0.72:
            browser_content(base, content, 0.2 + 0.09 * t)
    ai_p = out_back(clamp((t - 2.45) / 0.62))
    if ai_p > 0.08:
        ai_box = lerp_box((552, 663, 594, 696), (724, 278, 1168, 604), ai_p)
        content = window_frame(base, ai_box, "A-AI", "AI Services (Hidden App).png", "#6a5df5", close_only=True)
        if ai_p > 0.72:
            ai_content(base, content, clamp((t - 3.0) / 0.8))
    cx = 382 if t < 2.2 else lerp(382, 553, smooth((t - 2.2) / 0.8))
    cy = 663 if t < 2.2 else lerp(663, 667, smooth((t - 2.2) / 0.8))
    click = clamp(1 - abs(t - 0.48) / 0.22) + clamp(1 - abs(t - 2.48) / 0.22)
    draw_cursor(base, cx, cy, min(1, click))
    focus_x = lerp(560, 710, smooth(t / duration))
    return camera_frame(base, 1.035 + 0.018 * math.sin(t * 0.8), (focus_x, H / 2))


def store_scene(t, duration):
    base = background("Scotland.png", 12).copy()
    taskbar(base, active=("A-Store", "Paint"), t=1)
    scene_label(base, "A-Store", "Install it. Launch it.", clamp(t / 0.55))
    content = window_frame(base, (98, 130, 1182, 620), "A-Store", "Downloads.png", "#27b6ee")
    install_phase = clamp((t - 0.7) / 2.2)
    store_content(base, content, install_phase)
    paint_p = out_back(clamp((t - 3.0) / 0.7))
    if paint_p > 0.08:
        paint_box = lerp_box((558, 664, 602, 696), (440, 196, 1100, 608), paint_p)
        paint = window_frame(base, paint_box, "Paint", "Draw.png", "#6f73f3")
        if paint_p > 0.72:
            paint_content(base, paint, clamp((t - 3.45) / 1.15))
    if t < 3:
        cx, cy = lerp(1100, 220, smooth(t / 0.9)), lerp(500, 494, smooth(t / 0.9))
    else:
        cx, cy = lerp(220, 560, smooth((t - 3) / 0.75)), lerp(494, 666, smooth((t - 3) / 0.75))
    click = max(clamp(1 - abs(t - 0.9) / 0.22), clamp(1 - abs(t - 3.05) / 0.22))
    draw_cursor(base, cx, cy, click)
    focus_x = lerp(W / 2, 770, smooth((t - 2.8) / 1.2))
    return camera_frame(base, 1.025 + 0.035 * smooth((t - 2.7) / 1.0), (focus_x, 390))


def controls_scene(t, duration):
    base = background("Porto.png", 18).copy()
    taskbar(base, active=("Web", "Files"), t=1)
    files_content(base, window_frame(base, (82, 150, 710, 608), "Files", "Files.png"), "Downloads")
    scene_label(base, "Built into the OS", "Control the real device.", clamp(t / 0.55))
    quick_settings(base, clamp((t - 0.45) / 0.75), slider=0.3 + 0.52 * smooth((t - 1.6) / 1.3))
    toast(base, "Nearby device found", "Ready to send A-OS files", "PC.png", clamp((t - 2.45) / 0.55), 112)
    toast(base, "Update available", "Download safely in the background", "Reboot.png", clamp((t - 3.55) / 0.55), 208)
    if t < 1.7:
        cx, cy = lerp(1190, 1102, smooth(t / 0.8)), lerp(678, 406, smooth(t / 0.8))
    else:
        cx, cy = lerp(1102, 1178, smooth((t - 1.7) / 0.9)), lerp(406, 384, smooth((t - 1.7) / 0.9))
    draw_cursor(base, cx, cy, clamp(1 - abs(t - 1.75) / 0.25))
    return camera_frame(base, 1.075, (920, 365))


def family_scene(t, duration):
    base = background("Family Home.png").copy()
    taskbar(base, active=("Paint",), t=clamp(t / 0.5), vertical=True)
    scene_label(base, "Family Device", "A simpler space for everyone.", clamp(t / 0.55))
    draw = ImageDraw.Draw(base, "RGBA")
    top_p = out_back(clamp((t - 0.4) / 0.7))
    top_y = round(128 - 120 * (1 - top_p))
    rounded_panel(draw, (116, top_y, 1246, top_y + 82), 10, (250, 252, 252, 232), (255, 255, 255, 180))
    draw.text((150, top_y + 18), "Who is using A-OS?", font=F18B, fill="#18313d")
    for index, (name, color) in enumerate((("Alex", "#58c9e9"), ("Sam", "#ffcd57"), ("Parent", "#7e73ef"))):
        x = 430 + index * 210
        draw.ellipse((x, top_y + 14, x + 48, top_y + 62), fill=color)
        draw.text((x + 60, top_y + 27), name, font=F16, fill="#203a45")
    apps = [("Images.png", "Photos"), ("Draw.png", "Paint"), ("Internet.png", "Web"), ("Lucky.png", "Games")]
    for index, (icon_name, label) in enumerate(apps):
        p = out_back(clamp((t - 0.75 - index * 0.14) / 0.55))
        x = 140 + index * 275
        y = round(264 + 90 * (1 - p))
        rounded_panel(draw, (x, y, x + 230, y + 230), 9, (246, 251, 252, 235), (255, 255, 255, 185))
        put_icon(base, icon_name, x + 52, y + 25, 126, clamp(p))
        draw.text((x + 115, y + 178), label, font=F24B, fill="#18313d", anchor="ma")
    photo_p = out_back(clamp((t - 3.2) / 0.65))
    if photo_p > 0.08:
        box = lerp_box((28, 164, 78, 210), (328, 220, 1078, 620), photo_p)
        content = window_frame(base, box, "Photos", "Images.png", "#69c53c", close_only=True)
        if photo_p > 0.72:
            x1, y1, x2, y2 = content
            for index, name in enumerate(("Porto.png", "Scotland.png", "Faro.jpg")):
                image = background(name).resize((210, 142), Image.Resampling.LANCZOS)
                base.alpha_composite(image, (x1 + 10 + index * 226, y1 + 20))
                draw.rounded_rectangle((x1 + 10 + index * 226, y1 + 20, x1 + 220 + index * 226, y1 + 162), radius=6, outline="white", width=3)
            draw.text((x1 + 12, y1 + 188), "Your places, together", font=F18B, fill="#1c3540")
    draw_cursor(base, 184 if t < 3.1 else lerp(184, 48, smooth((t - 3.1) / 0.8)), 430 if t < 3.1 else lerp(430, 186, smooth((t - 3.1) / 0.8)), clamp(1 - abs(t - 3.25) / 0.24))
    return camera_frame(base, 1.035 - 0.02 * smooth(t / duration), (W / 2, 375))


def update_scene(t, duration):
    base = background("Aqua A (Default).png", 18).copy()
    taskbar(base, active=("Files",), t=1)
    scene_label(base, "Resilient updates", "Keep working. It keeps going.", clamp(t / 0.55))
    files_content(base, window_frame(base, (72, 146, 770, 612), "Files", "Files.png"))
    draw = ImageDraw.Draw(base, "RGBA")
    panel_p = out_back(clamp((t - 0.4) / 0.65))
    x1 = round(820 + 430 * (1 - panel_p))
    shadow_box(base, (x1, 174, x1 + 390, 548), 12, (248, 251, 252, 250), (194, 211, 220, 230))
    put_icon(base, "Reboot.png", x1 + 24, 200, 62)
    draw.text((x1 + 104, 204), "A-OS Update", font=F24B, fill="#18313d")
    draw.text((x1 + 104, 238), "Installing in the background", font=F12, fill="#68808b")
    update_p = smooth((t - 0.7) / 3.8)
    percent = round(lerp(42, 100, update_p))
    draw.rounded_rectangle((x1 + 24, 300, x1 + 366, 316), radius=8, fill="#d2e0e6")
    draw.rounded_rectangle((x1 + 24, 300, lerp(x1 + 24, x1 + 366, percent / 100), 316), radius=8, fill="#2bbbe3")
    draw.text((x1 + 24, 340), f"{percent}%", font=F20B, fill="#18313d")
    message = "Connection restored - resumed" if 1.9 < t < 2.8 else "Installing verified files"
    draw.text((x1 + 86, 343), message, font=F14, fill="#1683a2" if 1.9 < t < 2.8 else "#68808b")
    draw.rounded_rectangle((x1 + 24, 398, x1 + 366, 446), radius=7, fill="#e4f5f9")
    draw.text((x1 + 42, 413), "You can close this panel.", font=F14, fill="#17647c")
    if percent == 100:
        draw.rounded_rectangle((x1 + 24, 474, x1 + 366, 522), radius=22, fill="#20b47b")
        draw.text((x1 + 195, 488), "Ready to restart", font=F16B, fill="white", anchor="ma")
    tray_p = clamp((t - 1.25) / 0.5)
    if tray_p:
        draw.ellipse((1042, 652, 1080, 690), fill=(31, 174, 216, alpha(tray_p)))
        put_icon(base, "Reboot.png", 1048, 658, 26, tray_p)
    draw_cursor(base, lerp(1048, x1 + 348, smooth((t - 0.25) / 0.9)), lerp(677, 190, smooth((t - 0.25) / 0.9)), clamp(1 - abs(t - 1.1) / 0.22))
    return camera_frame(base, 1.055, (760, 360))


def finish_scene(t, duration):
    base = Image.new("RGBA", (W, H), "#061019")
    draw = ImageDraw.Draw(base, "RGBA")
    if t < 2.15:
        p = smooth(t / 1.45)
        draw.text((W / 2, 74), "Installed. Updated. Ready.", font=F64, fill=(255, 255, 255, alpha(p)), anchor="ma")
        steps = [("Tick.png", "UEFI boot verified"), ("Safe.png", "Your files stay saved"), ("ISO.png", "Remove the USB and restart")]
        for index, (icon_name, text) in enumerate(steps):
            row_p = out_back(clamp((t - 0.25 - index * 0.28) / 0.55))
            x = round(250 + 40 * (1 - row_p))
            y = 204 + index * 116
            put_icon(base, icon_name, x, y, 70, clamp(row_p))
            draw.text((x + 104, y + 19), text, font=F24B, fill=(221, 239, 245, alpha(row_p)))
        draw.rounded_rectangle((250, 586, 1030, 594), radius=4, fill="#243946")
        draw.rounded_rectangle((250, 586, lerp(250, 1030, p), 594), radius=4, fill="#42c9ed")
    else:
        p = ease_out(clamp((t - 2.15) / 0.76))
        size = round(lerp(220, 132, p))
        rounded_icon(base, "OS Logo.png", (W - size) / 2, 114 + (220 - size) / 2, size, max(26, size // 5), p)
        draw.text((W / 2, 342), "A-OS Desktop 3.5", font=F64, fill=(255, 255, 255, alpha(p)), anchor="ma")
        draw.text((W / 2, 430), "A real desktop. Built your way.", font=F24, fill=(171, 205, 218, alpha(p)), anchor="ma")
        rounded_panel(draw, (414, 508, 866, 574), 29, (42, 180, 221, alpha(p)), (108, 224, 249, alpha(p)))
        draw.text((W / 2, 528), "a-os-desktop.web.app", font=F20B, fill=(255, 255, 255, alpha(p)), anchor="ma")
    return base


SCENES = [
    (3.6, boot_scene),
    (4.8, files_scene),
    (1.45, chapter_scene("Everything. Together.", "Windows, apps and A-AI in one fluid workspace.", "#48d1f3", "OS Logo.png")),
    (4.9, multitask_scene),
    (4.9, store_scene),
    (1.45, chapter_scene("Designed around you.", "Real controls. Personal spaces. No compromises.", "#7b74ff", "Settings.png")),
    (4.6, controls_scene),
    (4.8, family_scene),
    (4.8, update_scene),
    (4.9, finish_scene),
]


def locate_scene(position):
    elapsed = 0
    for index, (duration, renderer) in enumerate(SCENES):
        if position < elapsed + duration or index == len(SCENES) - 1:
            return index, position - elapsed, duration, renderer
        elapsed += duration
    raise RuntimeError("No scene found")


def render(position):
    index, local, duration, renderer = locate_scene(position)
    frame = renderer(max(0, local), duration)
    if index > 0 and local < TRANSITION:
        previous_duration, previous = SCENES[index - 1]
        old = previous(previous_duration, previous_duration)
        p = ease_in_out(local / TRANSITION)
        old = camera_frame(old.convert("RGBA"), 1 + 0.075 * p)
        frame = camera_frame(frame.convert("RGBA"), 1.105 - 0.105 * p)
        frame = Image.blend(old, frame, p)
        if 0.32 < p < 0.68:
            flash = 1 - abs(p - 0.5) / 0.18
            frame = Image.blend(frame, Image.new("RGBA", (W, H), "white"), clamp(flash) * 0.08)
    return frame


def make_audio(path, seconds):
    sample_rate = 44100
    chords = [(220, 277.18, 329.63), (246.94, 293.66, 369.99), (196, 246.94, 329.63), (174.61, 220, 293.66)]
    scene_marks = (0, 3.6, 8.4, 9.85, 14.75, 19.65, 21.1, 25.7, 30.5, 35.3)
    clicks = (4.62, 6.75, 10.34, 12.4, 15.65, 17.75, 21.95, 23.35, 27.0, 29.0, 31.55, 34.15)
    chapter_marks = (8.4, 19.65, 35.3)
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, sample_rate, 0, "NONE", "not compressed"))
        frames = bytearray()
        for index in range(int(seconds * sample_rate)):
            t = index / sample_rate
            chord = chords[int(t // 4) % len(chords)]
            fade = min(1, t / 0.8, (seconds - t) / 1.2)
            pad = sum(math.sin(2 * math.pi * frequency * t + order * 0.7) for order, frequency in enumerate(chord)) / 3
            air = sum(math.sin(2 * math.pi * frequency * 2 * t) for frequency in chord) / 3
            bass = math.sin(2 * math.pi * chord[0] * 0.5 * t)
            beat = t % (60 / 124)
            kick = math.sin(2 * math.pi * (82 - 48 * min(1, beat * 13)) * beat) * math.exp(-beat * 19)
            hat_phase = t % (30 / 124)
            hat = math.sin(2 * math.pi * 6200 * t) * math.exp(-hat_phase * 42)
            impact = 0
            for event in scene_marks:
                delta = t - event
                if 0 <= delta < 0.55:
                    impact += (math.sin(2 * math.pi * 62 * delta) + 0.4 * math.sin(2 * math.pi * 118 * delta)) * math.exp(-delta * 8)
            riser = 0
            for event in chapter_marks:
                delta = event - t
                if 0 < delta < 0.75:
                    phase = 1 - delta / 0.75
                    riser += math.sin(2 * math.pi * (420 + phase * 1450) * t) * phase * 0.08
            click = 0
            for event in clicks:
                delta = t - event
                if 0 <= delta < 0.09:
                    click += math.sin(2 * math.pi * 1100 * delta) * math.exp(-delta * 42)
            duck = 0.68 + 0.32 * min(1, beat * 9)
            core = (pad * 0.092 + air * 0.025) * duck + bass * 0.06 + kick * 0.15 + hat * 0.014 + impact * 0.105 + riser + click * 0.12
            left = core + math.sin(2 * math.pi * chord[1] * t + 0.35) * 0.012
            right = core + math.sin(2 * math.pi * chord[2] * t - 0.35) * 0.012
            left_sample = int(max(-1, min(1, left * fade)) * 32767)
            right_sample = int(max(-1, min(1, right * fade)) * 32767)
            frames.extend(left_sample.to_bytes(2, "little", signed=True))
            frames.extend(right_sample.to_bytes(2, "little", signed=True))
        output.writeframes(frames)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    seconds = sum(duration for duration, _ in SCENES)
    total_frames = round(seconds * FPS)
    silent = OUT_DIR / ".showcase-video.mp4"
    audio = OUT_DIR / ".showcase-audio.wav"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(silent)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    poster_saved = False
    for number in range(total_frames):
        position = number / FPS
        frame = render(position)
        fade = min(1, position / 0.35, (seconds - position) / 0.65)
        if fade < 1:
            frame = ImageEnhance.Brightness(frame).enhance(max(0, fade))
        if not poster_saved and position >= 16.7:
            frame.convert("RGB").save(POSTER, quality=92, optimize=True)
            poster_saved = True
        encoder.stdin.write(frame.convert("RGB").tobytes())
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise SystemExit("Video encoder failed")
    make_audio(audio, seconds)
    subprocess.run([ffmpeg, "-y", "-i", str(silent), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(VIDEO)], check=True)
    silent.unlink(missing_ok=True)
    audio.unlink(missing_ok=True)
    print(f"Rendered {seconds:.1f} seconds")
    print(VIDEO)
    print(POSTER)


if __name__ == "__main__":
    main()
