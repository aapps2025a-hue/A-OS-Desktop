#!/usr/bin/env python3

from pathlib import Path
import math
import os
import subprocess
import wave

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT_DIR = PUBLIC / "assets" / "video"
VIDEO = OUT_DIR / "A-OS-Desktop-Showcase.mp4"
POSTER = OUT_DIR / "A-OS-Desktop-Showcase.jpg"
W, H, FPS = 1280, 720, 30
SCENE_TIME, TRANSITION = 4, 0.65


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


F16, F18, F20, F24 = (get_font(size) for size in (16, 18, 20, 24))
F28, F34, F42, F58, F76 = (get_font(size, True) for size in (28, 34, 42, 58, 76))


def asset(folder, name):
    return PUBLIC / "assets" / folder / name


def cover(path, dim=0, blur=0):
    image = Image.open(path).convert("RGB")
    scale = max(W / image.width, H / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left, top = (image.width - W) // 2, (image.height - H) // 2
    image = image.crop((left, top, left + W, top + H))
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    if dim:
        image = Image.blend(image, Image.new("RGB", (W, H), "#02070b"), dim)
    return image.convert("RGBA")


def icon(name, size):
    image = Image.open(asset("icons", name)).convert("RGBA")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
    return output


def put_icon(base, name, x, y, size):
    base.alpha_composite(icon(name, size), (x, y))


def panel(draw, box, radius=8, fill=(245, 250, 252, 236), outline=(255, 255, 255, 180)):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2)


def intro():
    base = cover(asset("backgrounds", "Aqua A (Default).png"), 0.38)
    draw = ImageDraw.Draw(base, "RGBA")
    put_icon(base, "OS Logo.png", 92, 166, 176)
    draw.text((304, 174), "A-OS Desktop", font=F76, fill="white")
    draw.text((308, 268), "3.0", font=F42, fill="#72d6f5")
    draw.text((308, 345), "Your computer. Your way.", font=F34, fill="white")
    draw.text((308, 400), "Fast, familiar and built around the apps you use.", font=F24, fill="#cfdae2")
    return base


def desktop():
    base = cover(asset("backgrounds", "Porto.png"), 0.08)
    draw = ImageDraw.Draw(base, "RGBA")
    panel(draw, (28, 24, 174, 622), 26, (223, 247, 252, 190))
    draw.text((62, 46), "Apps", font=F20, fill="#06202a")
    side = [("Downloads.png", "Store"), ("Internet.png", "Web"), ("Files.png", "Files"), ("Settings.png", "Settings")]
    for row, (name, label) in enumerate(side):
        y = 90 + row * 124
        put_icon(base, name, 64, y, 68)
        draw.text((98, y + 72), label, font=F16, fill="#09222c", anchor="ma")
    panel(draw, (224, 58, 1228, 616), 18)
    draw.rounded_rectangle((224, 58, 1228, 112), radius=18, fill=(210, 224, 233, 242))
    draw.text((254, 73), "A-Store", font=F24, fill="#10232e")
    draw.text((1134, 72), "-  □  ×", font=F24, fill="#10232e")
    draw.text((270, 151), "Everything for A-OS", font=F42, fill="#10232e")
    draw.text((272, 204), "Install useful apps in one click.", font=F20, fill="#5c7180")
    apps = [("Code.png", "A-Store Dev"), ("Images.png", "Photos"), ("AI Services (Hidden App).png", "A-AI"), ("Calculator.png", "Calculator")]
    for index, (name, label) in enumerate(apps):
        x = 272 + index * 222
        panel(draw, (x, 260, x + 184, 480), 8, (231, 240, 245, 255), (192, 210, 220, 255))
        put_icon(base, name, x + 38, 284, 108)
        draw.text((x + 92, 410), label, font=F18, fill="#172b37", anchor="ma")
        draw.text((x + 92, 446), "Open", font=F16, fill="#087dad", anchor="ma")
    panel(draw, (208, 642, 1244, 700), 24, (231, 247, 251, 224))
    draw.text((242, 660), "A-OS", font=F20, fill="#09212b")
    draw.text((1186, 660), "12:45", font=F20, fill="#09212b", anchor="ra")
    return base


def family():
    base = cover(asset("backgrounds", "Family Home.png"), 0.06)
    draw = ImageDraw.Draw(base, "RGBA")
    panel(draw, (0, 0, 116, 720), 28, (73, 209, 229, 180))
    draw.text((58, 24), "Apps", font=F18, fill="#06202a", anchor="ma")
    for row, name in enumerate(("Downloads.png", "Images.png", "Internet.png", "Security Shield.png")):
        put_icon(base, name, 26, 68 + row * 140, 64)
    panel(draw, (136, 26, 1254, 174), 12, (255, 255, 255, 218))
    draw.text((174, 52), "Simple mode", font=F20, fill="#087da8")
    draw.text((174, 83), "Big apps. Clear choices.", font=F42, fill="#172b37")
    draw.text((174, 136), "Family Device gives every person their own safe workspace.", font=F20, fill="#536a78")
    apps = [("Images.png", "Photos"), ("Draw.png", "Paint"), ("Internet.png", "Web"), ("Lucky.png", "Games")]
    for index, (name, label) in enumerate(apps):
        x = 166 + index * 272
        panel(draw, (x, 224, x + 232, 442), 8, (240, 247, 250, 224))
        put_icon(base, name, x + 54, 246, 124)
        draw.text((x + 116, 387), label, font=F28, fill="#172b37", anchor="ma")
    panel(draw, (166, 498, 666, 638), 8, (255, 221, 91, 238))
    draw.text((198, 526), "Protected adult controls", font=F28, fill="#172318")
    draw.text((198, 570), "Easy for children. Flexible for parents.", font=F18, fill="#354837")
    return base


def hardware():
    base = cover(asset("backgrounds", "Scotland.png"), 0.58, 2)
    draw = ImageDraw.Draw(base, "RGBA")
    draw.text((72, 64), "Real device controls", font=F58, fill="white")
    draw.text((76, 132), "Wi-Fi, Bluetooth, volume, brightness and battery.", font=F24, fill="#d5e1e8")
    panel(draw, (72, 210, 1208, 598), 12)
    controls = [("Internet.png", "Wi-Fi", "Home Network"), ("System.png", "Bluetooth", "Headphones connected"), ("Full Battery  Charging.png", "Battery", "86% · charging")]
    for index, (name, title, detail) in enumerate(controls):
        y = 244 + index * 102
        put_icon(base, name, 104, y, 66)
        draw.text((194, y + 4), title, font=F24, fill="#132a36")
        draw.text((194, y + 40), detail, font=F18, fill="#617785")
        if index < 2:
            panel(draw, (1048, y + 10, 1152, y + 54), 22, (53, 190, 231, 255))
            draw.ellipse((1110, y + 14, 1146, y + 50), fill="white")
    draw.text((762, 516), "Sound", font=F18, fill="#405764")
    draw.rounded_rectangle((836, 520, 1150, 534), radius=7, fill="#b8cdd8")
    draw.rounded_rectangle((836, 520, 1072, 534), radius=7, fill="#2d9ecd")
    return base


def update():
    base = cover(asset("backgrounds", "Faro.jpg"), 0.7, 3)
    draw = ImageDraw.Draw(base, "RGBA")
    panel(draw, (174, 98, 1106, 622), 12, (246, 250, 252, 246))
    put_icon(base, "Reboot.png", 226, 150, 88)
    draw.text((340, 148), "A-OS Update", font=F42, fill="#132a36")
    draw.text((342, 204), "Installing safely in the background", font=F20, fill="#607783")
    draw.rounded_rectangle((226, 294, 1054, 322), radius=14, fill="#d2dfe6")
    draw.rounded_rectangle((226, 294, 908, 322), radius=14, fill="#35bee7")
    draw.text((226, 346), "82% · Installing A-OS application files", font=F20, fill="#233b47")
    draw.text((226, 410), "Close this panel and keep working.", font=F28, fill="#132a36")
    draw.text((226, 458), "Interrupted updates resume from their verified revision.", font=F18, fill="#607783")
    panel(draw, (226, 522, 780, 570), 6, (221, 244, 250, 255))
    draw.text((248, 536), "Power actions wait until the update is safe.", font=F18, fill="#116b8d")
    return base


def install():
    base = Image.new("RGBA", (W, H), "#07101a")
    draw = ImageDraw.Draw(base, "RGBA")
    draw.text((72, 64), "Install once. Boot anywhere.", font=F58, fill="white")
    draw.text((76, 132), "Install beside Windows or use a dedicated drive.", font=F24, fill="#b9c9d4")
    steps = [("1", "Write the ISO", "Use Rufus in GPT/UEFI mode."), ("2", "Boot the USB", "A-OS copies the live system into RAM."), ("3", "Choose a disk", "Windows and recovery stay protected."), ("4", "Restart", "Remove the USB and boot A-OS.")]
    for index, (number, title, detail) in enumerate(steps):
        x, y = 72 + (index % 2) * 590, 224 + (index // 2) * 190
        draw.text((x, y), "0" + number, font=F34, fill="#55c8ef")
        draw.text((x + 82, y), title, font=F28, fill="white")
        draw.text((x + 82, y + 48), detail, font=F18, fill="#9fb2bf")
        draw.line((x + 82, y + 96, x + 510, y + 96), fill="#3e5261", width=1)
    draw.text((72, 628), "A-OS Desktop 3.0", font=F24, fill="#d7e2e8")
    draw.text((1208, 628), "a-os-desktop.web.app", font=F24, fill="#55c8ef", anchor="ra")
    return base


def moving(scene, amount):
    scale = 1 + 0.018 * amount
    resized = scene.resize((round(W * scale), round(H * scale)), Image.Resampling.BICUBIC)
    left, top = (resized.width - W) // 2, (resized.height - H) // 2
    return resized.crop((left, top, left + W, top + H))


def make_audio(path, seconds):
    sample_rate = 44100
    chords = [(220, 277.18, 329.63), (196, 246.94, 293.66), (174.61, 220, 261.63), (196, 246.94, 329.63)]
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, sample_rate, 0, "NONE", "not compressed"))
        frames = bytearray()
        for index in range(int(seconds * sample_rate)):
            t = index / sample_rate
            chord = chords[int(t // 4) % len(chords)]
            fade = min(1, t / 1.2, (seconds - t) / 1.2)
            pulse = 0.72 + 0.28 * math.sin(2 * math.pi * 0.25 * t) ** 2
            value = sum(math.sin(2 * math.pi * f * t) for f in chord) / 3
            value += 0.18 * math.sin(2 * math.pi * chord[0] * 0.5 * t)
            sample = int(max(-1, min(1, value * fade * pulse * 0.16)) * 32767)
            frames.extend(sample.to_bytes(2, "little", signed=True) * 2)
        output.writeframes(frames)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    scenes = [intro(), desktop(), family(), hardware(), update(), install()]
    seconds, total_frames = len(scenes) * SCENE_TIME, len(scenes) * SCENE_TIME * FPS
    silent, audio = OUT_DIR / ".showcase-video.mp4", OUT_DIR / ".showcase-audio.wav"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(silent)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    poster_saved = False
    for number in range(total_frames):
        position = number / FPS
        index = min(len(scenes) - 1, int(position // SCENE_TIME))
        local = position - index * SCENE_TIME
        frame = moving(scenes[index], local / SCENE_TIME)
        if local > SCENE_TIME - TRANSITION and index + 1 < len(scenes):
            mix = (local - SCENE_TIME + TRANSITION) / TRANSITION
            mix = mix * mix * (3 - 2 * mix)
            frame = Image.blend(frame, moving(scenes[index + 1], 0), mix)
        fade = min(1, position / 0.7, (seconds - position) / 0.7)
        if fade < 1:
            frame = ImageEnhance.Brightness(frame).enhance(max(0, fade))
        if not poster_saved and position >= 4.8:
            frame.convert("RGB").save(POSTER, quality=91, optimize=True)
            poster_saved = True
        encoder.stdin.write(frame.convert("RGB").tobytes())
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise SystemExit("Video encoder failed")
    make_audio(audio, seconds)
    subprocess.run([ffmpeg, "-y", "-i", str(silent), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(VIDEO)], check=True)
    silent.unlink(missing_ok=True)
    audio.unlink(missing_ok=True)
    print(VIDEO)
    print(POSTER)


if __name__ == "__main__":
    main()
