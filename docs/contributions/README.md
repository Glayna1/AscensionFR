# Registre public des contributions AscensionFR

Cette page statique fournit :

- une recherche par nom, texte, clé ou ID ;
- un filtre par catégorie, dont le nom est exactement le nom du fichier JSON ;
- une comparaison avant/après mot à mot ;
- la qualification automatique `ajout`, `modification` ou `suppression` ;
- la création d’une issue publique dans `LePetitDan/AscensionFR-Textes` ;
- un registre public des issues, auteurs, votes positifs et votes négatifs ;
- l’affichage public des comptes GitHub ayant voté.

## Source de vérité

Le navigateur découvre les catégories avec l’API publique GitHub, dans :

```text
LePetitDan/AscensionFR-Textes/traductions/*.json
```

Aucune liste de catégories n’est recopiée dans le code. Ajouter ou retirer un fichier JSON met donc automatiquement le filtre à jour.

## Traçabilité d’une proposition

Chaque issue générée contient :

1. le dépôt, la branche et le fichier ;
2. le chemin JSON exact ;
3. l’empreinte Git du fichier source ;
4. la valeur avant ;
5. la valeur après ;
6. le diff mot à mot ;
7. le nombre de mots ajoutés et retirés ;
8. le motif du contributeur ;
9. un bloc machine lisible `ascensionfr-proposal:v1`.

Les votes utilisent les réactions GitHub `+1` et `-1`. GitHub conserve publiquement l’identité des comptes ayant réagi.

## Absence de serveur privé

Le site est entièrement statique. Il ne possède :

- ni base de données ;
- ni compte local ;
- ni jeton GitHub embarqué ;
- ni collecte analytique ;
- ni canal de contribution privé.

La publication d’une proposition et d’un vote exige un compte GitHub, afin que l’auteur et le votant soient identifiables publiquement.
