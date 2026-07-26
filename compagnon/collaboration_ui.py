# -*- coding: utf-8 -*-
"""Espace collaborateur AscensionFR.

Composant Tk autonome afin que la logique Supabase reste séparée du gros
`interface_hub.py`. L'instance peut être ouverte depuis la vue Contribuer ou une
future entrée de navigation dédiée.
"""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox

from supabase_client import disponible
from services import auth_service, translation_service


class CollaborationWindow(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.title("AscensionFR — Collaborer")
        self.geometry("860x600")
        self.minsize(760, 520)
        self.current_entry = None
        self.profile = None
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        self._build()
        self._refresh_session()

    def _build(self):
        root = tk.Frame(self, padx=20, pady=20)
        root.pack(fill="both", expand=True)

        self.title_label = tk.Label(root, text="Espace collaborateur", font=("TkDefaultFont", 18, "bold"))
        self.title_label.pack(anchor="w")
        self.status = tk.Label(root, text="", anchor="w")
        self.status.pack(fill="x", pady=(4, 14))

        self.auth_frame = tk.LabelFrame(root, text="Connexion", padx=12, pady=12)
        self.auth_frame.pack(fill="x")
        tk.Label(self.auth_frame, text="E-mail").grid(row=0, column=0, sticky="w")
        self.email = tk.Entry(self.auth_frame, width=38)
        self.email.grid(row=0, column=1, padx=8)
        tk.Label(self.auth_frame, text="Mot de passe").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.password = tk.Entry(self.auth_frame, width=38, show="•")
        self.password.grid(row=1, column=1, padx=8, pady=(8, 0))
        tk.Button(self.auth_frame, text="Se connecter", command=self._login).grid(row=0, column=2, rowspan=2, padx=8)
        tk.Button(self.auth_frame, text="Créer le compte", command=self._signup).grid(row=0, column=3, rowspan=2, padx=8)

        self.work_frame = tk.LabelFrame(root, text="Pool de traduction", padx=12, pady=12)
        self.work_frame.pack(fill="both", expand=True, pady=(14, 0))
        self.meta = tk.Label(self.work_frame, text="", anchor="w")
        self.meta.pack(fill="x")
        tk.Label(self.work_frame, text="Texte original", font=("TkDefaultFont", 10, "bold")).pack(anchor="w", pady=(10, 2))
        self.original = tk.Text(self.work_frame, height=6, wrap="word", state="disabled")
        self.original.pack(fill="x")
        tk.Label(self.work_frame, text="Traduction proposée", font=("TkDefaultFont", 10, "bold")).pack(anchor="w", pady=(10, 2))
        self.translation = tk.Text(self.work_frame, height=6, wrap="word")
        self.translation.pack(fill="x")

        actions = tk.Frame(self.work_frame)
        actions.pack(fill="x", pady=(10, 0))
        self.next_button = tk.Button(actions, text="Charger un texte", command=self._load_pool)
        self.next_button.pack(side="left")
        self.submit_button = tk.Button(actions, text="Envoyer pour validation", command=self._submit, state="disabled")
        self.submit_button.pack(side="left", padx=8)
        tk.Button(actions, text="Déconnexion", command=self._logout).pack(side="right")

    def _set_status(self, text):
        self.status.configure(text=text)

    def _thread(self, fn):
        threading.Thread(target=fn, daemon=True).start()

    def _refresh_session(self):
        if not disponible():
            self._set_status("Service collaboratif non configuré sur ce build.")
            self.auth_frame.configure(state="disabled")
            return

        def worker():
            try:
                profile = auth_service.profil_courant()
            except Exception:
                profile = None
            self.after(0, self._apply_profile, profile)
        self._thread(worker)

    def _apply_profile(self, profile):
        self.profile = profile
        if profile is None:
            self._set_status("Connecte-toi pour accéder au pool de traduction.")
            return
        self._set_status(f"Connecté : {profile.display_name or profile.email or profile.user_id} — rôle {profile.role}")
        if profile.role in {"contributor", "reviewer", "admin"}:
            self._load_pool()
        else:
            self._set_status("Compte connecté. Le rôle contributeur doit être attribué par un administrateur.")

    def _login(self):
        email, password = self.email.get(), self.password.get()
        def worker():
            try:
                auth_service.connecter(email, password)
                profile = auth_service.profil_courant()
            except Exception as exc:
                self.after(0, messagebox.showerror, "Connexion", str(exc), parent=self)
                return
            self.after(0, self._apply_profile, profile)
        self._thread(worker)

    def _signup(self):
        email, password = self.email.get(), self.password.get()
        def worker():
            try:
                auth_service.inscrire(email, password)
            except Exception as exc:
                self.after(0, messagebox.showerror, "Inscription", str(exc), parent=self)
                return
            self.after(0, messagebox.showinfo, "Inscription", "Compte créé. Vérifie ton e-mail si la confirmation est activée.", parent=self)
        self._thread(worker)

    def _logout(self):
        try:
            auth_service.deconnecter()
        except Exception:
            pass
        self.current_entry = None
        self._apply_profile(None)
        self._show_original("")
        self.translation.delete("1.0", "end")
        self.submit_button.configure(state="disabled")

    def _load_pool(self):
        if not self.profile or self.profile.role not in {"contributor", "reviewer", "admin"}:
            return
        self._set_status("Chargement du pool…")
        def worker():
            try:
                rows = translation_service.pool(limit=10)
                if not rows:
                    self.after(0, self._set_status, "Aucun texte disponible pour le moment.")
                    return
                entry = rows[0]
                translation_service.reserver(entry["id"], 20)
            except Exception as exc:
                self.after(0, self._set_status, f"Pool indisponible : {exc}")
                return
            self.after(0, self._apply_entry, entry)
        self._thread(worker)

    def _apply_entry(self, entry):
        self.current_entry = entry
        self.meta.configure(text=f"{entry.get('source_type', 'unknown')} · ID {entry.get('source_id') or '—'} · détecté {entry.get('discovered_count', 1)} fois")
        self._show_original(entry.get("original_text", ""))
        self.translation.delete("1.0", "end")
        self.submit_button.configure(state="normal")
        self._set_status("Texte réservé pendant 20 minutes.")

    def _show_original(self, text):
        self.original.configure(state="normal")
        self.original.delete("1.0", "end")
        self.original.insert("1.0", text)
        self.original.configure(state="disabled")

    def _submit(self):
        if not self.current_entry:
            return
        text = self.translation.get("1.0", "end").strip()
        if not text:
            messagebox.showwarning("Traduction", "La traduction ne peut pas être vide.", parent=self)
            return
        entry_id = self.current_entry["id"]
        self.submit_button.configure(state="disabled")
        def worker():
            try:
                translation_service.soumettre(entry_id, text)
            except Exception as exc:
                self.after(0, self._set_status, f"Envoi impossible : {exc}")
                self.after(0, self.submit_button.configure, {"state": "normal"})
                return
            self.after(0, self._set_status, "Traduction envoyée pour validation.")
            self.after(0, self._load_pool)
        self._thread(worker)


def ouvrir(parent):
    """Point d'intégration minimal pour `interface_hub.py`."""
    return CollaborationWindow(parent)
