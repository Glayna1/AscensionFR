# -*- coding: utf-8 -*-
from __future__ import annotations

from urllib.parse import urlparse

from supabase_client import client


VALID_STATUSES = {"draft", "pending", "approved", "rejected", "suspended"}


def _https_url(value: str, field: str) -> str:
    value = value.strip()
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{field} doit être une URL HTTPS valide.")
    return value


def catalogue_public() -> list[dict]:
    return client().table("addons").select(
        "id,slug,name,description,repository_url,release_url,addon_folder,version,license,category,published_at"
    ).eq("status", "approved").order("name").execute().data or []


def proposer(owner_id: str, slug: str, name: str, description: str,
             repository_url: str, addon_folder: str, release_url: str | None = None,
             version: str | None = None, license_name: str | None = None,
             category: str | None = None) -> dict:
    slug = slug.strip().lower()
    addon_folder = addon_folder.strip()
    if "/" in addon_folder or "\\" in addon_folder or not addon_folder:
        raise ValueError("Nom de dossier addon invalide.")
    payload = {
        "owner_id": owner_id,
        "slug": slug,
        "name": name.strip()[:100],
        "description": description.strip()[:4000],
        "repository_url": _https_url(repository_url, "repository_url"),
        "release_url": _https_url(release_url, "release_url") if release_url else None,
        "addon_folder": addon_folder,
        "version": version.strip()[:64] if version else None,
        "license": license_name.strip()[:80] if license_name else None,
        "category": category.strip()[:80] if category else None,
    }
    if not payload["name"] or not payload["description"]:
        raise ValueError("Nom et description obligatoires.")
    return client().table("addons").insert(payload).execute().data


def soumettre(addon_id: str, owner_id: str) -> None:
    # L'owner ne peut passer que son propre draft/rejected à pending.
    response = client().table("addons").update({"status": "pending"}).eq(
        "id", addon_id
    ).eq("owner_id", owner_id).in_("status", ["draft", "rejected"]).execute()
    if not response.data:
        raise RuntimeError("Addon introuvable ou non soumettable.")
