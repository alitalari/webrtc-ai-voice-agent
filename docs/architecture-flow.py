"""Generate docs/architecture-flow.png — the current end-to-end flow.

Run: python docs/architecture-flow.py   (needs Pillow)
"""

import math
from PIL import Image, ImageDraw, ImageFont

W, H = 1760, 1180
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


def box(x, y, w, h, title, sub=None, border="#333", fill="#ffffff", tcol="#111"):
    d.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=fill, outline=border, width=2)
    d.text((x + 14, y + 9), title, font=font(19, True), fill=tcol)
    if sub:
        d.multiline_text((x + 14, y + 36), sub, font=font(14), fill="#444", spacing=4)


def label(cx, cy, text, size=15, col="#555", bold=False, anchor="mm"):
    d.text((cx, cy), text, font=font(size, bold), fill=col, anchor=anchor)


def arrow(x1, y1, x2, y2, color="#444", width=3):
    d.line([x1, y1, x2, y2], fill=color, width=width)
    ang = math.atan2(y2 - y1, x2 - x1)
    L, a = 13, 0.45
    d.polygon(
        [(x2, y2),
         (x2 - L * math.cos(ang - a), y2 - L * math.sin(ang - a)),
         (x2 - L * math.cos(ang + a), y2 - L * math.sin(ang + a))],
        fill=color,
    )


# --- title ---
label(W / 2, 38, "AI Voice SDK — End-to-End Flow", 34, "#111", True)
label(W / 2, 76,
      "current state  ·  Phases 0–2 complete  ·  WebRTC media-path milestone 1 (fake providers, audio echo)",
      16, "#666")

BLUE, GREEN = "#3b6ea5", "#3a7d44"

# --- panels ---
d.rounded_rectangle([50, 110, 570, 770], radius=16, fill="#eef4fb", outline=BLUE, width=2)
label(310, 138, "BROWSER  (client)", 21, "#26527d", True)
d.rounded_rectangle([1190, 110, 1710, 770], radius=16, fill="#eef7ef", outline=GREEN, width=2)
label(1450, 138, "SERVER  —  reference backend", 21, "#2c6135", True)

# --- browser boxes ---
box(80, 190, 460, 70, "Mic capture", "getUserMedia({ audio: true })", BLUE)
box(80, 282, 460, 86, "RTCPeerConnection", "• addTrack(mic)\n• createDataChannel('control')", BLUE)
box(80, 392, 460, 70, "Audio playback", "<audio>  ←  echoed mic (milestone 1)", BLUE)
box(80, 484, 460, 70, "Event log", "renders ServerEvents from the data channel", BLUE)

# --- server boxes ---
box(1220, 190, 460, 70, "HTTP signaling", "POST /session   ·   offer → answer", GREEN)
box(1220, 282, 460, 86, "werift peer + WeriftServerTransport", "ICE · DTLS · SRTP audio · SCTP data channel", GREEN)
box(1220, 392, 460, 86, "SessionOrchestrator", "cascade ASR → LLM → TTS\nbarge-in cancellation · latency metrics", GREEN)
box(1220, 502, 460, 86, "Endpointer + State machine", "VAD → turn events\nidle→listening→userSpeaking→thinking→speaking", GREEN)
box(1220, 612, 460, 86, "Providers (fake, swappable)", "ASR · LLM · TTS\n→ Deepgram / Claude / Cartesia (Phase 3)", GREEN)

# --- connection bands (the gap between panels) ---
GX1, GX2 = 570, 1190

label(880, 196, "1 · Signaling — HTTP / TCP  (one-shot, non-trickle ICE)", 15, "#444", True)
arrow(GX1, 224, GX2, 224)
label(880, 214, "POST /session  { offer SDP }", 13, "#777", anchor="mm")
arrow(GX2, 250, GX1, 250)
label(880, 240, "{ answer SDP }", 13, "#777", anchor="mm")

label(880, 392, "2 · WebRTC audio track — UDP · SRTP (DTLS) · ICE host candidates", 15, "#444", True)
arrow(GX1, 420, GX2, 420)
label(880, 410, "mic: Opus → SRTP", 13, "#777", anchor="mm")
arrow(GX2, 446, GX1, 446)
label(880, 436, "echo back", 13, "#777", anchor="mm")

label(880, 520, "3 · WebRTC data channel — SCTP over DTLS  (ordered, reliable)", 15, "#444", True)
arrow(GX1, 548, GX2, 548)
arrow(GX2, 548, GX1, 548)
label(880, 566, "control events  +  VAD   (JSON)", 13, "#777", anchor="mm")

# server-internal flow
arrow(1450, 368, 1450, 392, GREEN)   # transport -> orchestrator
arrow(1450, 478, 1450, 502, GREEN)   # orchestrator -> endpointer/SM
arrow(1450, 588, 1450, 612, GREEN)   # SM -> providers

# --- bottom strip: a turn end to end ---
d.rounded_rectangle([50, 812, 1710, 1140], radius=16, fill="#f7f7f5", outline="#c9c9c9", width=2)
label(880, 842, "A TURN, END-TO-END", 19, "#333", True)

steps = [
    ("You speak", "mic audio streams to the\nserver (and echoes back\nso you hear yourself)"),
    ("VAD → endpoint", "Endpointer sees speech\nthen silence → emits\n'endpointed'"),
    ("State machine", "listening → userSpeaking\n→ thinking on endpoint"),
    ("Cascade runs", "ASR final → LLM stream\n→ TTS stream → audio"),
    ("Barge-in?", "if you talk over it:\ncancel LLM+TTS, flush,\n→ userSpeaking"),
    ("Back to client", "transcript / agent events\n/ metrics.latency over\nthe data channel"),
]
n = len(steps)
bw, gap = 248, 20
x0 = 80
y0, bh = 884, 210
for i, (t, s) in enumerate(steps):
    x = x0 + i * (bw + gap)
    box(x, y0, bw, bh, "", s, "#9aa6b2")
    # number badge
    d.ellipse([x + 12, y0 + 12, x + 44, y0 + 44], fill="#26527d")
    label(x + 28, y0 + 28, str(i + 1), 18, "#fff", True)
    d.text((x + 54, y0 + 16), t, font=font(17, True), fill="#111")
    if i < n - 1:
        arrow(x + bw + 1, y0 + bh / 2, x + bw + gap - 1, y0 + bh / 2, "#888", 3)

img.save("docs/architecture-flow.png")
print("wrote docs/architecture-flow.png", img.size)
