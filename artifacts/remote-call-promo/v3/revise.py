#!/usr/bin/env python3
"""Render the Remote Call promo with the V7 public-key call flow."""
from pathlib import Path
import importlib.util
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "v2" / "revise.py"
spec = importlib.util.spec_from_file_location("remote_call_promo_v2", SOURCE)
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)

promo.ROOT = ROOT
promo.MODEL_ROOT = SOURCE.parent / "models"
promo.p.ROOT = ROOT
promo.p.BUILD = ROOT / "build"
promo.p.BUILD.mkdir(exist_ok=True)

for scene in promo.SCENES:
    if scene["id"] == "invite":
        scene["lines"] = [
            "Open the page, share your joint link privately, and allow camera and microphone access.",
            "Then compare security codes together.",
        ]
    elif scene["id"] == "key":
        scene["title"] = ["A public key.", "Private keys stay private."]
        scene["sub"] = "The link carries only the caller's public key."
        scene["lines"] = [
            "The joint link carries only a public key. Private keys stay on your devices.",
            "Compare matching security codes before your encrypted call starts.",
        ]
promo.p.SCENES = promo.SCENES

previous_illustration = promo.p.right_illustration


def illustrate(im, draw, scene, time, index):
    if scene["kind"] != "key":
        return previous_illustration(im, draw, scene, time, index)
    y = 244
    promo.p.card(draw, 1090, y, 690, 511, True)
    promo.p.icon(draw, "lock", 1435, y + 124, 116, "#147C69", 7)
    promo.p.text(draw, (1435, y + 226), "PUBLIC KEY IN LINK", 27,
                 promo.p.C["dark"], "bold", anchor="ma")
    promo.p.rr(draw, (1142, y + 295, 1728, y + 378), 15,
               fill="#EAF2EE", outline="#B7D0C6")
    promo.p.fit_text(draw, (1164, y + 317), "#call-public-key=...", 544, 25,
                     "#147C69", "mono")
    promo.p.text(draw, (1435, y + 413), "Private keys stay on your devices.",
                 25, "#52687B", "demi", anchor="ma")


promo.p.right_illustration = illustrate


def documents(scenes, cues, total):
    promo.p.documents(scenes, cues, total)
    note = ROOT / "production-notes.md"
    body = note.read_text().replace(
        "- Invitation includes the call secret in its fragment: refreshJointLink() in js/remote-call-connection.js. Protect the entire invitation.",
        "- Invitation includes the caller's public key; private keys and derived media secrets stay out of the link. Compare security codes through another trusted channel.")
    note.write_text(body +
                    "\n## V7 security wording\n\n"
                    "The invitation contains the caller's ECDH public key. Each browser keeps its "
                    "private key locally and derives a media secret after the receiver joins. "
                    "Participants compare security codes through another trusted channel before "
                    "starting media. No private key or symmetric media secret appears in the link.\n")
    html = ROOT / "preview.html"
    html.write_text(html.read_text().replace("English narration", "English neural narration"))


promo.docs = documents

if __name__ == "__main__":
    if "--render" in sys.argv:
        # Rendering code changed; discard only the generated silent-video cache.
        (promo.p.BUILD / "picture.webm").unlink(missing_ok=True)
    promo.main()
    if "--render" in sys.argv:
        destination = ROOT / "remote-call-public-key-promo.webm"
        shutil.copy2(ROOT / "remote-call-promo.webm", destination)
        print(f"PUBLIC-KEY PROMO: {destination}", flush=True)
