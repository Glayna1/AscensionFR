# -*- coding: utf-8 -*-
from __future__ import annotations

from supabase_client import client


ALLOWED_DECISIONS = {"approved", "rejected", "changes_requested"}


def pool(limit: int = 25, source_type: str | None = None) -> list[dict]:
    limit = max(1, min(int(limit), 100))
    query = client().table("translation_entries").select(
        "id,source_type,source_id,original_text,context,status,discovered_count"
    ).in_("status", ["untranslated", "claimed"]).order(
        "discovered_count", desc=True
    ).limit(limit)
    if source_type:
        query = query.eq("source_type", source_type)
    return query.execute().data or []


def reserver(entry_id: str, minutes: int = 20) -> dict:
    response = client().rpc("claim_translation", {
        "p_entry_id": entry_id,
        "p_minutes": max(5, min(int(minutes), 120)),
    }).execute()
    return response.data


def soumettre(entry_id: str, traduction: str) -> str:
    traduction = traduction.strip()
    if not traduction:
        raise ValueError("La traduction ne peut pas être vide.")
    response = client().rpc("submit_translation", {
        "p_entry_id": entry_id,
        "p_translation": traduction,
    }).execute()
    return str(response.data)


def mes_propositions(limit: int = 50) -> list[dict]:
    # RLS limite déjà la lecture aux propres soumissions ou aux reviewers.
    return client().table("translation_submissions").select(
        "id,entry_id,translation,status,review_note,created_at,reviewed_at,"
        "translation_entries(original_text,source_type,source_id,context)"
    ).order("created_at", desc=True).limit(max(1, min(limit, 100))).execute().data or []


def a_valider(limit: int = 50) -> list[dict]:
    return client().table("translation_submissions").select(
        "id,entry_id,author_id,translation,status,created_at,"
        "translation_entries(original_text,source_type,source_id,context)"
    ).eq("status", "pending").order("created_at").limit(max(1, min(limit, 100))).execute().data or []


def reviewer(submission_id: str, decision: str, note: str | None = None,
             corrected_translation: str | None = None) -> None:
    if decision not in ALLOWED_DECISIONS:
        raise ValueError("Décision de review invalide.")
    client().rpc("review_translation", {
        "p_submission_id": submission_id,
        "p_decision": decision,
        "p_note": note,
        "p_corrected_translation": corrected_translation,
    }).execute()
