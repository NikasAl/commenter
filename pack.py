#!/usr/bin/env python3
"""
Commenter Extension — Pack script
Собирает расширение в zip-архив для загрузки в Chrome Web Store или ручной установки.
"""

import zipfile
import os
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "commenter-extension.zip"

# Файлы для включения в архив
INCLUDE = [
    "manifest.json",
    "popup/popup.html",
    "popup/popup.css",
    "popup/popup.js",
    "options/options.html",
    "options/options.css",
    "options/options.js",
    "viewer/viewer.html",
    "viewer/viewer.css",
    "viewer/viewer.js",
    "background/service-worker.js",
    "lib/storage.js",
    "lib/providers/provider-base.js",
    "lib/providers/z-ai.js",
    "lib/providers/openrouter.js",
    "lib/providers/local.js",
    "assets/icons/icon16.png",
    "assets/icons/icon48.png",
    "assets/icons/icon128.png",
]

def pack():
    if DIST.exists():
        DIST.unlink()

    with zipfile.ZipFile(DIST, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in INCLUDE:
            fp = ROOT / rel
            if fp.exists():
                zf.write(fp, rel)
                print(f"  + {rel}")
            else:
                print(f"  ! MISSING: {rel}")

    size_kb = DIST.stat().st_size / 1024
    print(f"\nDone: {DIST.name} ({size_kb:.1f} KB)")

if __name__ == "__main__":
    print("Packing Commenter extension...")
    pack()
