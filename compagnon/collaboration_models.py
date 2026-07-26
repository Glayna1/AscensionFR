# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field


@dataclass(frozen=True)
class TranslationDiscovery:
    source_type: str
    original_text: str
    source_id: str | None = None
    context: dict = field(default_factory=dict)

    def fingerprint(self) -> str:
        field_name = str(self.context.get("field") or "")
        raw = "\x1f".join((
            str(self.source_type or "unknown").lower(),
            str(self.source_id or ""),
            field_name,
            self.original_text.strip(),
        ))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
