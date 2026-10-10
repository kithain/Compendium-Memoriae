# Ajouter ou remplacer une illustration

Les illustrations principales sont des JPG du dépôt GitHub. Elles sont publiques, même si la fiche est en brouillon. Les textes et les notes restent protégés par les droits de la campagne. Les pièces jointes de l’éditeur sont un stockage distinct, privé.

1. Déposez votre image dans le dossier de la catégorie, par exemple `public/images/pnj/mon-personnage.jpg`. Le format conseillé est 400 × 300 pixels. Choisissez un nom court sans espaces ni accents, avec `.jpg` en minuscules. Lettres, chiffres, tirets, underscores et points sont acceptés ; le nom commence par une lettre ou un chiffre.
2. Lancez `publier.cmd` et attendez la réussite de la publication GitHub Pages. En local, le fichier est disponible dès son dépôt.
3. Ouvrez **Modifier la fiche → Illustration** et saisissez `images/pnj/mon-personnage.jpg` dans **Chemin de l’image**, puis enregistrez. Ne mettez pas `public/`, une adresse web ou un chemin Windows.

| Catégorie | Dossier local | Début du chemin dans la fiche |
| --- | --- | --- |
| Lieux | `public/images/lieux/` | `images/lieux/` |
| PNJ | `public/images/pnj/` | `images/pnj/` |
| Factions | `public/images/factions/` | `images/factions/` |
| Cosmogonie | `public/images/cosmogonie/` | `images/cosmogonie/` |
| Histoire | `public/images/histoire/` | `images/histoire/` |
| Cultures | `public/images/cultures/` | `images/cultures/` |
| Savoirs | `public/images/savoirs/` | `images/savoirs/` |

Pour remplacer l’image, utilisez de préférence un nouveau nom, publiez le fichier puis changez le chemin dans la fiche. Cela évite qu’un navigateur conserve l’ancienne version en cache. Vider le champ retire l’image de la fiche ; cela ne supprime pas le JPG du dépôt.

Seuls les JPG placés directement dans ces sept dossiers sont publiés. Les fichiers JSON/TXT, les sous-dossiers historiques de travail et `.private/` ne sont pas copiés vers le site. Les sauvegardes et les correspondances de migration restent privées. Le frontend peut encore lire une ancienne clé du bucket privé `compendium-images` ; cette compatibilité ne rend pas ce bucket public.
