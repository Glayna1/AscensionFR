# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Iterable

from supabase_client import configuration, disponible


@dataclass(frozen=True)
class Discovery:
    source_type: str
    original_text: str
    source_id: str | None = None
    context: dict | None = None


def _endpoint() -> str:
    url, _ = configuration()
    return url.rstrip("/") + "/functions/v1/submit-discovery"


def envoyer_decouvertes(entries: Iterable[Discovery], timeout: int = 20) -> int:
    if not disponible():
        raise RuntimeError("Service collaboratif non configuré.")

    items = list(entries)
    if not items:
        return 0
    if len(items) > 500:
        raise ValueError("Un lot ne peut pas dépasser 500 entrées.")

    payload = {
        "entries": [
            {
                "source_type": item.source_type,
                "source_id": item.source_id,
                "original_text": item.original_text,
                "context": item.context or {},
            }
            for item in items
        ]
    }
    _, key = configuration()
    request = urllib.request.Request(
        _endpoint(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": "Bearer " + key,
            "User-Agent": "AscensionFR-Hub",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        raise RuntimeError(f"Contribution refusée par le serveur ({exc.code}) : {detail}") from exc
    return int(data.get("accepted", 0))
