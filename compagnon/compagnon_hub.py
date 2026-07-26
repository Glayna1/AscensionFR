# -*- coding: utf-8 -*-
"""
Point d'entrée du HUB AscensionFR (interface v3, paysage).
==========================================================
Le Hub est le successeur en chantier du Compagnon : même moteur
(`compagnon.py`), interface « fenêtre World of Warcraft »
(`interface_hub.py`) étendue par `interface_hub_collaboration.py` pour les
fonctions communautaires Supabase. Sans configuration Supabase, les fonctions
historiques restent disponibles.

Essai : `python compagnon_hub.py`
"""
from interface_hub_collaboration import main

if __name__ == "__main__":
    main()
