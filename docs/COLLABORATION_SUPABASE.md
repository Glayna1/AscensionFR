# Plateforme collaborative AscensionFR / Supabase

Cette documentation décrit le déploiement de la couche collaborative introduite par `feat/collaboration-platform`.

## Principes

- GitHub reste la source de vérité du code et des releases.
- Supabase stocke les comptes, rôles, textes détectés, propositions, reviews et soumissions d'addons.
- Le Hub reste utilisable sans compte et sans Supabase.
- Aucune clé `service_role` n'est embarquée dans l'application.
- Les changements de rôle et de statut sensibles passent par des fonctions PostgreSQL privilégiées.
- L'ingestion anonyme passe uniquement par l'Edge Function `submit-discovery`.

## Dépendance à la PR #3

Cette branche part du HEAD de `uv-setup` (PR #3). Elle utilise donc `pyproject.toml`, `uv` et Python 3.14.

Après modification des dépendances :

```bash
uv lock
uv sync
```

## Déployer la base

Avec Supabase CLI connecté au projet :

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy submit-discovery
```

La migration crée notamment :

- `profiles`
- `translation_entries`
- `translation_submissions`
- `translation_claims`
- `addons`
- `addon_media`

ainsi que les fonctions :

- `current_role()`
- `set_user_role()`
- `claim_translation()`
- `submit_translation()`
- `review_translation()`
- `submit_addon()`
- `review_addon()`

## Configuration du Hub

Le Hub n'utilise que la clé publique/publishable :

```text
ASCENSIONFR_SUPABASE_URL=https://<project-ref>.supabase.co
ASCENSIONFR_SUPABASE_KEY=<publishable-key>
```

Ne jamais fournir :

```text
SUPABASE_SERVICE_ROLE_KEY
mot de passe PostgreSQL
PAT GitHub
```

au binaire distribué.

`SUPABASE_SERVICE_ROLE_KEY` est uniquement lu dans l'environnement sécurisé de l'Edge Function.

## Rôles

- `user` : compte standard ; aucun accès au pool.
- `contributor` : accès pool + claim + soumission.
- `reviewer` : review des traductions et addons.
- `developer` : création et soumission d'addons.
- `admin` : administration applicative.

Un utilisateur ne peut pas changer son propre rôle avec un `UPDATE profiles`. Le changement passe par `set_user_role()` et exige un admin ou `service_role` côté serveur.

Exemple depuis un contexte serveur/admin :

```sql
select public.set_user_role('<uuid>', 'contributor');
```

## Flux traduction

```text
jeu -> rapport -> submit-discovery -> translation_entries
                                 -> pool
                                 -> claim_translation
                                 -> submit_translation
                                 -> review_translation
                                 -> approved
                                 -> prochain export/build
```

`review_translation()` est transactionnelle : la proposition, le reviewer, le statut de l'entrée et le compteur d'approbation sont modifiés dans la même transaction PostgreSQL.

## Ingestion / anti-abus

L'Edge Function applique :

- POST uniquement ;
- taille HTTP bornée ;
- maximum 500 entrées par lot ;
- type de source en liste blanche ;
- maximum 8 KiB par texte ;
- maximum 32 KiB de contexte ;
- fingerprint SHA-256 recalculé côté serveur ;
- aucune écriture directe `anon` sur `translation_entries`.

Un rate limit global (Supabase / reverse proxy) doit être configuré en production en complément de ces contrôles applicatifs.

## Fingerprint

Le fingerprint utilise :

```text
source_type + \x1f + source_id + \x1f + context.field + \x1f + original_text
```

Deux chaînes identiques appartenant à deux objets ou champs différents ne sont donc pas automatiquement fusionnées.

## Addons

Le développeur crée une fiche `draft`, peut la modifier, puis appelle `submit_addon()`.

Il ne peut pas passer lui-même son addon à `approved`. Le reviewer/admin appelle `review_addon()`.

Le Hub sécurise également l'extraction ZIP :

- refus des chemins absolus ;
- refus de `../` ;
- nombre de fichiers borné ;
- taille décompressée bornée ;
- présence du `.toc` attendu vérifiée avant copie finale.

## Interface

`compagnon_hub.py` charge `interface_hub_collaboration.py`, qui étend le Hub historique sans réécrire `interface_hub.py`.

Dans la vue **Contribuer**, un lien **Espace collaborateur** ouvre `collaboration_ui.py`.

Le compte n'est jamais requis pour :

- installer la traduction ;
- mettre le Hub à jour ;
- installer un addon du catalogue local ;
- gérer les voix ;
- envoyer les contributions par le chemin historique lorsqu'il est configuré.

## Mise en production progressive

1. Déployer migrations + Edge Function.
2. Configurer un build de test avec URL + clé publique.
3. Attribuer `contributor` à un petit groupe.
4. Valider le workflow claim -> submit -> review.
5. Activer l'ingestion Supabase en parallèle du circuit actuel.
6. Observer erreurs, doublons et volume.
7. Migrer ensuite le catalogue dynamique et l'export build.

## Export vers les builds

Les traductions `approved` doivent être exportées par une tâche serveur/CI disposant de credentials dédiés. Le client du Hub ne doit jamais déclencher une release ni posséder les secrets permettant d'écrire sur GitHub.

Le build doit consommer uniquement les entrées :

```text
translation_entries.status = approved
translation_entries.approved_submission_id != null
```

puis valider la syntaxe des fichiers générés avant packaging.
