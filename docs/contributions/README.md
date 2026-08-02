# Observatoire public AscensionFR

Cette page statique est **strictement en lecture seule**. Elle ne permet ni de modifier un texte, ni de créer une proposition, ni de voter.

Elle fournit :

- une recherche par nom, texte, clé ou ID ;
- un filtre par catégorie, dont le nom est exactement le nom du fichier JSON ;
- l’historique GitHub d’une valeur précise ;
- une comparaison avant/après mot à mot ;
- la qualification automatique `ajout`, `modification` ou `suppression` ;
- le nombre de mots ajoutés et retirés ;
- l’auteur et la date de chaque commit ;
- les pull requests associées aux commits ;
- les réactions et revues GitHub publiques, avec les comptes concernés.

## Source de vérité

Le navigateur découvre les catégories avec l’API publique GitHub, dans :

```text
LePetitDan/AscensionFR-Textes/traductions/*.json
```

Aucune liste de catégories n’est recopiée dans le code. Ajouter ou retirer un fichier JSON met automatiquement le filtre à jour.

## Comparaison exacte

Pour un commit, la page récupère publiquement :

1. son parent Git ;
2. les fichiers JSON avant le commit ;
3. les mêmes fichiers après le commit ;
4. toutes les valeurs primitives de chaque JSON ;
5. le chemin exact de chaque valeur différente ;
6. l’opération effectuée : ajout, modification ou suppression ;
7. le diff mot à mot entre l’ancienne et la nouvelle valeur.

Un changement d’un seul mot est donc affiché comme tel. Les très gros commits sont affichés par lots, mais tous leurs changements restent consultables.

## Votes et revues

Lorsqu’un commit est associé à une pull request publique, la page affiche en lecture seule :

- les réactions `+1` et `-1` ;
- les comptes ayant réagi ;
- les revues `APPROVED` ;
- les revues `CHANGES_REQUESTED` ;
- les commentaires de revue.

Lorsqu’un commit a été poussé directement sans pull request, la page l’indique clairement : aucun vote public ne peut alors lui être attribué.

## Absence d’écriture et de serveur privé

Le site ne possède :

- aucun formulaire d’édition ;
- aucun bouton de proposition ;
- aucun bouton de vote ;
- aucune base de données ;
- aucun compte local ;
- aucun jeton GitHub embarqué ;
- aucune collecte analytique ;
- aucun canal privé de contribution.

Toutes les informations affichées viennent des API et fichiers publics de GitHub.
