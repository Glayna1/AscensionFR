# -*- coding: utf-8 -*-
"""Validation d'archives téléchargées avant extraction."""
from __future__ import annotations

import os
import zipfile

MAX_FILES = 5000
MAX_UNCOMPRESSED = 512 * 1024 * 1024


def validate_zip(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_FILES:
        raise ValueError("Archive addon trop volumineuse (trop de fichiers).")

    total = 0
    for info in infos:
        name = info.filename.replace("\\", "/")
        if name.startswith("/") or name.startswith("../") or "/../" in name:
            raise ValueError("Archive addon invalide : chemin relatif interdit.")
        if ":" in name.split("/", 1)[0]:
            raise ValueError("Archive addon invalide : chemin absolu interdit.")
        total += max(0, info.file_size)
        if total > MAX_UNCOMPRESSED:
            raise ValueError("Archive addon trop volumineuse après extraction.")


def extract_zip_safely(zf: zipfile.ZipFile, destination: str) -> None:
    validate_zip(zf)
    root = os.path.abspath(destination)
    os.makedirs(root, exist_ok=True)
    for info in zf.infolist():
        target = os.path.abspath(os.path.join(root, info.filename))
        if os.path.commonpath((root, target)) != root:
            raise ValueError("Archive addon invalide : tentative de sortie du dossier.")
        zf.extract(info, root)
