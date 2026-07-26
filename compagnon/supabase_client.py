# -*- coding: utf-8 -*-
"""Client Supabase facultatif du Hub AscensionFR.

Le Hub doit rester utilisable sans Supabase. Cette couche n'embarque jamais de
service_role : uniquement l'URL du projet et la clé publique/publishable.
"""
from __future__ import annotations

import os
from functools import lru_cache

try:
    from supabase import Client, create_client
except ImportError:  # permet au Hub historique de démarrer sans la dépendance
    Client = object  # type: ignore[assignment,misc]
    create_client = None


ENV_URL = "ASCENSIONFR_SUPABASE_URL"
ENV_KEY = "ASCENSIONFR_SUPABASE_KEY"


def configuration() -> tuple[str, str]:
    return os.environ.get(ENV_URL, "").strip(), os.environ.get(ENV_KEY, "").strip()


def disponible() -> bool:
    url, key = configuration()
    return bool(url and key and create_client is not None)


@lru_cache(maxsize=1)
def client() -> Client:
    if create_client is None:
        raise RuntimeError("Le paquet Python 'supabase' n'est pas installé.")
    url, key = configuration()
    if not url or not key:
        raise RuntimeError(
            f"Supabase n'est pas configuré ({ENV_URL}/{ENV_KEY})."
        )
    return create_client(url, key)


def reset_client() -> None:
    """Utile pour les tests ou après changement de configuration."""
    client.cache_clear()
