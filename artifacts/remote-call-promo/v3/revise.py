#!/usr/bin/env python3
"""Render the Remote Call promo with the current optional 2FA flow."""
from pathlib import Path
import importlib.util
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "voice_renderer.py"
spec = importlib.util.spec_from_file_location("remote_call_promo_v3", SOURCE)
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)

promo.ROOT = ROOT
promo.MODEL_ROOT = ROOT / "models"
promo.p.ROOT = ROOT
promo.p.BUILD = ROOT / "build"
promo.p.BUILD.mkdir(exist_ok=True)

for scene in promo.SCENES:
    if scene["id"] == "invite":
        scene["lines"] = [
            "Open the page and share your joint link privately.",
            "For extra assurance, turn on 2FA and compare security codes before the call starts.",
        ]
    elif scene["id"] == "key":
        scene["title"] = ["No key in the link.", "Private keys stay private."]
        scene["sub"] = "The key exchange begins after the receiver joins."
        scene["lines"] = [
            "Your joint link contains no encryption key. The key exchange starts only after the other person joins.",
            "A fresh call secret is encrypted for that participant, never placed in the link.",
        ]
promo.p.SCENES = promo.SCENES

previous_illustration = promo.p.right_illustration


def illustrate(im, draw, scene, time, index):
    if scene["kind"] != "key":
        return previous_illustration(im, draw, scene, time, index)
    y = 244
    promo.p.card(draw, 1090, y, 690, 511, True)
    promo.p.icon(draw, "lock", 1435, y + 124, 116, "#147C69", 7)
    promo.p.text(draw, (1435, y + 226), "NO KEY IN LINK", 27,
                 promo.p.C["dark"], "bold", anchor="ma")
    promo.p.rr(draw, (1142, y + 295, 1728, y + 378), 15,
               fill="#EAF2EE", outline="#B7D0C6")
    promo.p.fit_text(draw, (1164, y + 317), "?source-host=...", 544, 25,
                     "#147C69", "mono")
    promo.p.text(draw, (1435, y + 413), "Key exchange follows joining.",
                 25, "#52687B", "demi", anchor="ma")


promo.p.right_illustration = illustrate


def documents(scenes, cues, total):
    promo.p.documents(scenes, cues, total)
    note = ROOT / "production-notes.md"
    body = note.read_text()
    note.write_text(body +
                    "\n## Current security wording\n\n"
                    "The invitation contains routing details and call settings, but no cryptographic key. "
                    "The caller encrypts a fresh call secret for the receiver after they join. "
                    "The receiver's private key remains local. Optional 2FA asks both people to "
                    "compare security codes through another trusted channel before starting media. "
                    "No private key or symmetric media secret appears in the link.\n")
    html = ROOT / "preview.html"
    html.write_text(html.read_text().replace("English narration", "English neural narration"))


promo.docs = documents

if __name__ == "__main__":
    if "--render" in sys.argv:
        # Rendering code changed; discard only the generated silent-video cache.
        (promo.p.BUILD / "picture.webm").unlink(missing_ok=True)
    promo.main()
    if "--render" in sys.argv:
        print(f"CORRECTED PROMO: {ROOT / 'remote-call-promo-v3-voice-fixed.webm'}", flush=True)
