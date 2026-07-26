# -*- coding: utf-8 -*-
"""Extension collaborative du Hub v3.

Cette couche évite d'alourdir `interface_hub.py` : elle hérite du Hub existant,
ajoute un accès à l'espace collaborateur dans la vue Contribuer et remplace
l'extraction ZIP par la variante sécurisée. Si Supabase n'est pas configuré,
le Hub historique reste pleinement fonctionnel.
"""
from __future__ import annotations

import ctypes
import os
import shutil
import sys
import tempfile
import zipfile

import interface_hub as base
from archive_security import extract_zip_safely
from collaboration_ui import ouvrir as ouvrir_collaboration
from supabase_client import disponible


def installer_addon_zip_securise(chemin_zip, jeu, dossier):
    addons = os.path.join(jeu, "Interface", "AddOns")
    tampon = tempfile.mkdtemp(prefix="AscensionFR_addon_")
    try:
        with zipfile.ZipFile(chemin_zip) as archive:
            extract_zip_safely(archive, tampon)
        source = None
        for racine, _dossiers, fichiers in os.walk(tampon):
            if any(f.lower() == (dossier + ".toc").lower() for f in fichiers):
                source = racine
                break
        if not source:
            raise ValueError("le zip ne contient pas " + dossier + ".toc")
        cible = os.path.join(addons, dossier)
        if os.path.isdir(cible):
            shutil.rmtree(cible)
        shutil.copytree(source, cible)
    finally:
        shutil.rmtree(tampon, ignore_errors=True)


# Toutes les installations d'addons réalisées par les méthodes définies dans
# interface_hub résolvent ce nom dans le module base au moment de l'appel.
base.installer_addon_zip = installer_addon_zip_securise


class CollaborativeHub(base.Hub):
    def __init__(self, demo=None):
        super().__init__(demo=demo)
        self._construire_acces_collaboration()
        self.bind("<Control-Shift-C>", lambda _e: self.ouvrir_collaboration())

    def _construire_acces_collaboration(self):
        """Ajoute le portail à la vue Contribuer sans nécessiter de nouveaux PNG."""
        cx = base.M["CX"]
        y = 486
        texte = (
            "Espace collaborateur — traduire le pool, suivre ses propositions "
            "et participer aux validations"
        )
        self.collab_link = self.canvas.create_text(
            cx + 34,
            y,
            anchor="w",
            text=texte,
            font=self.p_lien,
            fill=base.OR_SOMBRE,
            tags=("vue_contribuer",),
        )
        self.canvas.tag_bind(self.collab_link, "<Button-1>", lambda _e: self.ouvrir_collaboration())
        self.canvas.tag_bind(self.collab_link, "<Enter>", lambda _e: self.canvas.configure(cursor="hand2"))
        self.canvas.tag_bind(self.collab_link, "<Leave>", lambda _e: self.canvas.configure(cursor=""))

        sous = (
            "Connexion facultative : le Hub reste utilisable sans compte. "
            "Le pool collaboratif nécessite un rôle attribué par l'équipe."
            if disponible()
            else "Le service collaboratif n'est pas configuré sur ce build ; les fonctions historiques restent disponibles."
        )
        self.canvas.create_text(
            cx + 34,
            y + 26,
            anchor="nw",
            text=sous,
            font=self.p_mini,
            fill=base.ENCRE_DOUCE,
            width=base.M["CW"] - 90,
            tags=("vue_contribuer",),
        )

    def ouvrir_collaboration(self):
        ouvrir_collaboration(self)


def main():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    args = sys.argv[1:]
    demo = None
    capture = None
    if "--demo" in args:
        i = args.index("--demo")
        demo = args[i + 1] if i + 1 < len(args) else "accueil"
    if "--capture" in args:
        i = args.index("--capture")
        capture = args[i + 1] if i + 1 < len(args) else "hub.png"

    app = CollaborativeHub(demo=demo)
    if demo:
        app.montrer_vue(demo if demo in base.VUES else "accueil")
    if capture:
        app.attributes("-topmost", True)
        app.update_idletasks()
        app.update()

        def prendre():
            from PIL import ImageGrab
            app.lift()
            app.focus_force()
            app.update()
            x = app.winfo_rootx()
            y = app.winfo_rooty()
            ImageGrab.grab(bbox=(x, y, x + base.M["W"], y + base.M["H"])).save(capture)
            print("capture :", capture)
            app.destroy()

        app.after(700, prendre)
    app.mainloop()


if __name__ == "__main__":
    main()
