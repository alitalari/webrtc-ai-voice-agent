"""Generate docs/pipeline.png — the ASR → LLM → TTS cascade for one turn.

Run: python docs/pipeline.py   (needs Pillow)
"""

import math
from PIL import Image, ImageDraw, ImageFont

W, H = 1460, 470
img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def label(cx, cy, text, size=15, col="#555", bold=False, anchor="mm"):
    d.text((cx, cy), text, font=font(size, bold), fill=col, anchor=anchor)


def stage(x, y, w, h, title, sub, border):
    d.rounded_rectangle([x, y, x + w, y + h], radius=12, fill="#ffffff", outline=border, width=3)
    label(x + w / 2, y + h / 2 - 11, title, 26, "#111", True)
    label(x + w / 2, y + h / 2 + 18, sub, 13, "#666")


def arrow(x1, y1, x2, y2, color="#3a3f4a", width=4):
    d.line([x1, y1, x2, y2], fill=color, width=width)
    ang = math.atan2(y2 - y1, x2 - x1)
    L, a = 15, 0.5
    d.polygon(
        [(x2, y2),
         (x2 - L * math.cos(ang - a), y2 - L * math.sin(ang - a)),
         (x2 - L * math.cos(ang + a), y2 - L * math.sin(ang + a))],
        fill=color,
    )


def line_label(x1, x2, cy, text, kind):
    cx = (x1 + x2) / 2
    col = "#c77d1a" if kind == "audio" else "#2c6135"
    fill = "#fbf1df" if kind == "audio" else "#e9f4ec"
    tw = 62 if kind == "audio" else 52
    d.rounded_rectangle([cx - tw / 2, cy - 34, cx + tw / 2, cy - 12], radius=8, fill=fill, outline=col, width=1)
    label(cx, cy - 23, text, 13, col, True)


BLUE, PURPLE, GREEN = "#4f8cff", "#a06bff", "#2fae86"
cy = 268  # pipeline centerline

# --- title ---
label(W / 2, 34, "AI Voice Agent — one turn, end to end", 30, "#111", True)
label(W / 2, 68, "your speech in, the agent's voice out — the cascade is ASR → LLM → TTS", 15, "#777")

# --- server panel (contains the three stages) ---
d.rounded_rectangle([300, 120, 1150, 400], radius=18, fill="#eef7ef", outline="#3a7d44", width=3)
label(325, 150, "SERVER", 19, "#2c6135", True, anchor="lm")

# --- three stages inside the server ---
stage(330, 216, 235, 104, "ASR", "speech → text", BLUE)
stage(602, 216, 235, 104, "LLM", "text → reply", PURPLE)
stage(874, 216, 235, 104, "TTS", "text → speech", GREEN)

# --- microphone (user, left) ---
d.rounded_rectangle([128, 208, 172, 278], radius=22, fill="#26527d")
d.arc([112, 230, 188, 300], start=0, end=180, fill="#26527d", width=5)
d.line([150, 300, 150, 330], fill="#26527d", width=5)
d.line([124, 330, 176, 330], fill="#26527d", width=5)
label(150, 356, "You", 16, "#26527d", True)
label(150, 378, "(microphone)", 12, "#8b93a3")

# --- speaker (user, right) ---
sx = 1300
d.rectangle([sx - 18, 244, sx + 4, 292], fill="#2c6135")
d.polygon([(sx + 4, 244), (sx + 34, 214), (sx + 34, 322), (sx + 4, 292)], fill="#2c6135")
for i, r in enumerate((22, 40)):
    d.arc([sx + 40 - r, 268 - r, sx + 40 + r, 268 + r], start=-55, end=55, fill="#2c6135", width=4)
label(sx + 8, 356, "You", 16, "#2c6135", True)
label(sx + 8, 378, "(speaker)", 12, "#8b93a3")

# --- arrows + line labels ---
arrow(190, cy, 326, cy)      # mic -> ASR
line_label(190, 300, cy, "audio", "audio")
arrow(569, cy, 598, cy)      # ASR -> LLM
line_label(565, 602, cy, "text", "text")
arrow(841, cy, 870, cy)      # LLM -> TTS
line_label(837, 874, cy, "text", "text")
arrow(1113, cy, 1286, cy)    # TTS -> speaker
line_label(1150, 1286, cy, "audio", "audio")

img.save("docs/pipeline.png")
print("wrote docs/pipeline.png", img.size)
