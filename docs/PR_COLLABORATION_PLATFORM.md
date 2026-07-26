# PR — Plateforme collaborative Supabase

## Objectif

Poursuivre la PR #3 (`uv-setup`) en ouvrant non seulement le développement du projet, mais aussi la contribution fonctionnelle depuis le Hub.

## Implémenté dans cette branche

### Base / sécurité

- schéma Supabase versionné par migrations ;
- profils et rôles `user`, `contributor`, `reviewer`, `developer`, `admin` ;
- RLS sur les tables exposées ;
- changement de rôle via `set_user_role()` uniquement ;
- aucune clé `service_role` dans le client Python ;
- validation transactionnelle des traductions ;
- workflow transactionnel pour soumission/review des addons.

### Ingestion

- Edge Function `submit-discovery` ;
- aucune policy `anon INSERT` sur le pool ;
- validation taille/type/contexte ;
- fingerprint recalculé côté serveur ;
- déduplication des découvertes ;
- limite de batch.

### Hub

- client Supabase facultatif ;
- service Auth ;
- service de contribution ;
- service de traduction ;
- service addons ;
- espace Collaborateur depuis la vue `Contribuer` ;
- claim 20 min puis soumission pour review ;
- aucune obligation de compte pour le Hub historique ;
- fallback naturel lorsque Supabase n'est pas configuré.

### Addons

- fiches développeur en base ;
- statut `draft -> pending -> approved/rejected` ;
- impossible pour le propriétaire d'auto-approuver son addon ;
- extraction ZIP sécurisée avant installation ;
- validation du `.toc` attendu conservée.

### Qualité

- tests fingerprints ;
- tests path traversal ZIP ;
- CI Windows Python 3.14/uv ;
- contrôle CI empêchant l'introduction de `SUPABASE_SERVICE_ROLE_KEY` dans `compagnon/` ;
- documentation de déploiement.

## Intégration volontairement progressive

Le code ne supprime pas le fonctionnement historique Discord/catalogue local dans cette première étape. Le but est de permettre un déploiement parallèle, de mesurer les volumes et d'activer Supabase sans rendre le Hub dépendant d'un service distant.

## Configuration requise pour tester Supabase

```text
ASCENSIONFR_SUPABASE_URL=https://<project>.supabase.co
ASCENSIONFR_SUPABASE_KEY=<publishable-key>
```

Puis déployer les migrations et l'Edge Function décrites dans `docs/COLLABORATION_SUPABASE.md`.

## À faire avant merge production

- régénérer `uv.lock` après ajout de `supabase` et `pytest` ;
- renseigner un projet Supabase de staging ;
- tester Auth + attribution de rôle ;
- tester claim concurrent avec deux comptes ;
- tester review traduction ;
- tester soumission/review addon ;
- définir le rate limiting production de l'Edge Function ;
- décider du format final d'export des traductions `approved` vers le pipeline de build.
