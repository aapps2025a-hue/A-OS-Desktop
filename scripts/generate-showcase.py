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
CAPTURES = ROOT / "build" / "showcase-captures"
OUT_DIR = PUBLIC / "assets" / "video"
VIDEO = OUT_DIR / "A-OS-Desktop-Showcase.mp4"
POSTER = OUT_DIR / "A-OS-Desktop-Showcase.jpg"
W, H, FPS = 1920, 1080, 30
WIPE_SECONDS = 0.24


def get_font(size, bold=False):
    windows = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    options = [
        windows / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        windows / ("segoeuivariable_static_display_semibold.ttf" if bold else "segoeuivariable_static_display.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for path in options:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


F18 = get_font(18)
F22 = get_font(22)
F24B = get_font(24, True)
F32 = get_font(32)
F46B = get_font(46, True)
F64B = get_font(64, True)
F86B = get_font(86, True)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smooth(value):
    value = clamp(value)
    return value * value * (3 - 2 * value)


def ease_out(value):
    value = clamp(value)
    return 1 - (1 - value) ** 4


def lerp(start, end, progress):
    return start + (end - start) * progress


def alpha(value):
    return round(clamp(value) * 255)


@lru_cache(maxsize=24)
def capture(name):
    path = CAPTURES / f"{name}.png"
    if not path.is_file():
        raise FileNotFoundError(f"Missing {path}. Run node scripts/capture-showcase.mjs first.")
    image = Image.open(path).convert("RGBA")
    if image.size != (W, H):
        image = image.resize((W, H), Image.Resampling.LANCZOS)
    return image


@lru_cache(maxsize=1)
def logo():
    path = PUBLIC / "assets" / "icons" / "OS Logo.png"
    return Image.open(path).convert("RGBA")


@lru_cache(maxsize=1)
def pointer():
    path = PUBLIC / "assets" / "cursors" / "cursor.png"
    image = Image.open(path).convert("RGBA")
    image.thumbnail((52, 52), Image.Resampling.LANCZOS)
    return image


def add_pointer(frame, start, end, progress, click_at=0.58):
    move = smooth(progress)
    x = round(lerp(start[0], end[0], move))
    y = round(lerp(start[1], end[1], move))
    draw = ImageDraw.Draw(frame, "RGBA")
    click_delta = abs(progress - click_at)
    if click_delta < 0.12:
        ring = click_delta / 0.12
        radius = round(18 + ring * 26)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(42, 190, 238, alpha(1 - ring)), width=4)
    frame.alpha_composite(pointer(), (x, y))


def caption(frame, eyebrow, title, detail, progress, side="left"):
    enter = ease_out(progress / 0.24)
    leave = smooth((1 - progress) / 0.14)
    visible = min(enter, leave)
    if visible <= 0:
        return
    draw = ImageDraw.Draw(frame, "RGBA")
    title_box = draw.textbbox((0, 0), title, font=F46B)
    detail_box = draw.textbbox((0, 0), detail, font=F22)
    width = max(520, title_box[2] - title_box[0] + 76, detail_box[2] - detail_box[0] + 76)
    if side == "right":
        x = round(W - width - 42 + (1 - enter) * (width + 60))
    else:
        x = round(42 - (1 - enter) * (width + 60))
    y = 68
    draw.rectangle((x, y, x + width, y + 168), fill=(3, 10, 17, alpha(0.94 * visible)))
    draw.rectangle((x, y, x + 7, y + 168), fill=(49, 193, 230, alpha(visible)))
    draw.text((x + 36, y + 25), eyebrow.upper(), font=F18, fill=(105, 218, 247, alpha(visible)))
    draw.text((x + 36, y + 57), title, font=F46B, fill=(255, 255, 255, alpha(visible)))
    draw.text((x + 38, y + 120), detail, font=F22, fill=(191, 209, 219, alpha(visible)))


def intro_frame(t, duration):
    frame = Image.new("RGBA", (W, H), "#05080b")
    draw = ImageDraw.Draw(frame, "RGBA")
    enter = ease_out(t / 0.72)
    leave = smooth((duration - t) / 0.45)
    visible = min(enter, leave)
    icon = logo().copy()
    size = round(lerp(248, 286, enter))
    icon.thumbnail((size, size), Image.Resampling.LANCZOS)
    icon.putalpha(icon.getchannel("A").point(lambda value: round(value * visible)))
    frame.alpha_composite(icon, (W // 2 - icon.width // 2, round(lerp(290, 244, enter))))
    draw.text((W // 2, 604), "A-OS 4.0", font=F86B, fill=(255, 255, 255, alpha(visible)), anchor="mm")
    draw.text((W // 2, 686), "The desktop, made personal.", font=F32, fill=(166, 194, 207, alpha(visible)), anchor="mm")
    line = round(lerp(0, 420, smooth((t - 0.35) / 0.9)))
    draw.rectangle((W // 2 - line // 2, 752, W // 2 + line // 2, 758), fill=(48, 193, 229, alpha(visible)))
    return frame


def ui_frame(scene, t):
    frame = capture(scene["capture"]).copy()
    progress = clamp(t / scene["duration"])
    caption(frame, scene["eyebrow"], scene["title"], scene["detail"], progress, scene.get("caption_side", "left"))
    if scene.get("cursor_start") and scene.get("cursor_end"):
        add_pointer(frame, scene["cursor_start"], scene["cursor_end"], clamp((progress - 0.12) / 0.62), scene.get("click_at", 0.58))
    return frame


def end_frame(t, duration):
    frame = Image.new("RGBA", (W, H), "#05080b")
    draw = ImageDraw.Draw(frame, "RGBA")
    enter = ease_out(t / 0.6)
    leave = smooth((duration - t) / 0.55)
    visible = min(enter, leave)
    icon = logo().copy()
    icon.thumbnail((184, 184), Image.Resampling.LANCZOS)
    icon.putalpha(icon.getchannel("A").point(lambda value: round(value * visible)))
    frame.alpha_composite(icon, (W // 2 - icon.width // 2, 238))
    draw.text((W // 2, 524), "Your desktop. Your way.", font=F64B, fill=(255, 255, 255, alpha(visible)), anchor="mm")
    draw.text((W // 2, 618), "A-OS 4.0", font=F32, fill=(107, 218, 247, alpha(visible)), anchor="mm")
    draw.text((W // 2, 720), "aapps2025a-hue.github.io/A-OS-Desktop", font=F24B, fill=(184, 203, 213, alpha(visible)), anchor="mm")
    return frame


SCENES = [
    {"type": "intro", "duration": 3.0},
    {"type": "ui", "capture": "01-desktop", "duration": 3.2, "eyebrow": "A-OS DESKTOP", "title": "Ready when you are.", "detail": "A complete desktop with your apps, files and controls.", "cursor_start": (1550, 820), "cursor_end": (938, 1010)},
    {"type": "ui", "capture": "02-search", "duration": 3.0, "eyebrow": "SYS SEARCH", "title": "Find anything.", "detail": "Apps, files and actions appear above the taskbar.", "cursor_start": (1190, 910), "cursor_end": (324, 1015)},
    {"type": "ui", "capture": "03-quick-settings", "duration": 3.0, "eyebrow": "QUICK SETTINGS", "title": "Controls, one click away.", "detail": "Network, sound, brightness and power stay close.", "cursor_start": (1160, 900), "cursor_end": (1505, 1016)},
    {"type": "ui", "capture": "04-a-ai", "duration": 3.0, "eyebrow": "A-AI", "title": "Ask without leaving your work.", "detail": "A-AI opens directly above its taskbar shortcut.", "cursor_start": (1380, 900), "cursor_end": (1785, 1015)},
    {"type": "ui", "capture": "05-openbox", "duration": 3.0, "eyebrow": "OPENBOX", "title": "Desktop commands, built in.", "detail": "Open Files and Terminal or leave A-OS from one menu.", "caption_side": "right", "cursor_start": (420, 190), "cursor_end": (97, 20)},
    {"type": "ui", "capture": "06-taskbar-wide", "duration": 3.2, "eyebrow": "TASKBAR", "title": "Arrange it your way.", "detail": "Move controls, resize the bar and choose its layout.", "cursor_start": (1350, 900), "cursor_end": (840, 1016)},
    {"type": "ui", "capture": "07-windows", "duration": 3.4, "eyebrow": "WINDOWS", "title": "Work across real apps.", "detail": "Files and Settings stay movable, focused and familiar.", "cursor_start": (1480, 900), "cursor_end": (1080, 350)},
    {"type": "ui", "capture": "08-store", "duration": 3.4, "eyebrow": "A-STORE", "title": "Apps, ready to install.", "detail": "Discover A-OS apps and manage them from one place.", "cursor_start": (1450, 900), "cursor_end": (1110, 550)},
    {"type": "ui", "capture": "09-filedrop", "duration": 3.4, "eyebrow": "FILEDROP", "title": "Send files across devices.", "detail": "Share from the browser without a separate desktop app.", "cursor_start": (1460, 900), "cursor_end": (1030, 600)},
    {"type": "end", "duration": 3.0},
]


def scene_frame(index, local):
    scene = SCENES[index]
    if scene["type"] == "intro":
        return intro_frame(local, scene["duration"])
    if scene["type"] == "end":
        return end_frame(local, scene["duration"])
    return ui_frame(scene, local)


def locate(position):
    elapsed = 0.0
    for index, scene in enumerate(SCENES):
        if position < elapsed + scene["duration"] or index == len(SCENES) - 1:
            return index, max(0.0, position - elapsed)
        elapsed += scene["duration"]
    raise RuntimeError("No showcase scene found.")


def render(position):
    index, local = locate(position)
    current = scene_frame(index, local)
    if index > 0 and local < WIPE_SECONDS:
        previous = scene_frame(index - 1, SCENES[index - 1]["duration"])
        reveal = round(W * smooth(local / WIPE_SECONDS))
        if reveal < W:
            current.paste(previous.crop((reveal, 0, W, H)), (reveal, 0))
    return current


def make_audio(path, seconds):
    sample_rate = 44100
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (246.94, 311.13, 369.99)]
    marks = []
    elapsed = 0.0
    for scene in SCENES:
        marks.append(elapsed)
        elapsed += scene["duration"]
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, sample_rate, 0, "NONE", "not compressed"))
        frames = bytearray()
        for index in range(int(seconds * sample_rate)):
            t = index / sample_rate
            chord = chords[int(t // 4) % len(chords)]
            fade = min(1.0, t / 1.2, (seconds - t) / 1.2)
            pad = sum(math.sin(2 * math.pi * frequency * t + order * 0.55) for order, frequency in enumerate(chord)) / 3
            bass = math.sin(2 * math.pi * chord[0] * 0.5 * t)
            pulse_phase = t % 0.96
            pulse = math.sin(2 * math.pi * 74 * pulse_phase) * math.exp(-pulse_phase * 9)
            accent = 0.0
            for mark in marks:
                delta = t - mark
                if 0 <= delta < 0.34:
                    accent += math.sin(2 * math.pi * 620 * delta) * math.exp(-delta * 14)
            core = pad * 0.075 + bass * 0.04 + pulse * 0.035 + accent * 0.05
            left = core + math.sin(2 * math.pi * chord[1] * t + 0.25) * 0.008
            right = core + math.sin(2 * math.pi * chord[2] * t - 0.25) * 0.008
            frames.extend(int(max(-1, min(1, left * fade)) * 32767).to_bytes(2, "little", signed=True))
            frames.extend(int(max(-1, min(1, right * fade)) * 32767).to_bytes(2, "little", signed=True))
        output.writeframes(frames)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    missing = [scene["capture"] for scene in SCENES if scene["type"] == "ui" and not (CAPTURES / f"{scene['capture']}.png").is_file()]
    if missing:
        raise SystemExit("Missing real A-OS captures. Run: node scripts/capture-showcase.mjs")
    seconds = sum(scene["duration"] for scene in SCENES)
    total_frames = round(seconds * FPS)
    silent = OUT_DIR / ".showcase-video.mp4"
    audio = OUT_DIR / ".showcase-audio.wav"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(silent)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    poster_saved = False
    for number in range(total_frames):
        position = number / FPS
        frame = render(position)
        fade = min(1.0, position / 0.35, (seconds - position) / 0.6)
        if fade < 1:
            frame = ImageEnhance.Brightness(frame).enhance(max(0.0, fade))
        if not poster_saved and position >= 7.4:
            frame.convert("RGB").save(POSTER, quality=95, subsampling=0, optimize=True)
            poster_saved = True
        encoder.stdin.write(frame.convert("RGB").tobytes())
        if number % (FPS * 5) == 0:
            print(f"Rendered {position:.0f}/{seconds:.0f}s", flush=True)
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise SystemExit("Video encoder failed.")
    make_audio(audio, seconds)
    subprocess.run([ffmpeg, "-y", "-i", str(silent), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(VIDEO)], check=True)
    silent.unlink(missing_ok=True)
    audio.unlink(missing_ok=True)
    print(f"Rendered {seconds:.1f} seconds at {W}x{H}")
    print(VIDEO)
    print(POSTER)


if __name__ == "__main__":
    main()
