# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from supabase_client import client


@dataclass(frozen=True)
class SessionProfile:
    user_id: str
    email: str | None
    display_name: str | None
    role: str
    avatar_url: str | None


def inscrire(email: str, password: str, display_name: str | None = None) -> Any:
    email = email.strip()
    if not email or len(password) < 8:
        raise ValueError("Adresse e-mail invalide ou mot de passe trop court.")
    options = {"data": {"display_name": display_name.strip()}} if display_name and display_name.strip() else None
    payload: dict[str, Any] = {"email": email, "password": password}
    if options:
        payload["options"] = options
    return client().auth.sign_up(payload)


def connecter(email: str, password: str) -> Any:
    return client().auth.sign_in_with_password({
        "email": email.strip(),
        "password": password,
    })


def deconnecter() -> None:
    client().auth.sign_out()


def profil_courant() -> SessionProfile | None:
    auth_response = client().auth.get_user()
    user = getattr(auth_response, "user", None)
    if user is None:
        return None
    response = client().table("profiles").select(
        "id,display_name,avatar_url,role"
    ).eq("id", str(user.id)).single().execute()
    row = response.data
    return SessionProfile(
        user_id=str(user.id),
        email=getattr(user, "email", None),
        display_name=row.get("display_name"),
        role=row.get("role", "user"),
        avatar_url=row.get("avatar_url"),
    )


def modifier_profil(display_name: str | None = None, avatar_url: str | None = None) -> dict:
    profile = profil_courant()
    if profile is None:
        raise RuntimeError("Connexion requise.")
    payload: dict[str, str | None] = {}
    if display_name is not None:
        payload["display_name"] = display_name.strip()[:80]
    if avatar_url is not None:
        payload["avatar_url"] = avatar_url.strip()[:2048] or None
    if not payload:
        return {}
    # role et compteurs ne figurent volontairement jamais dans le payload.
    return client().table("profiles").update(payload).eq("id", profile.user_id).execute().data
