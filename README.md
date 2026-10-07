# Compendium Memoriae

Fiches de lieux et de PNJ partagées avec les joueurs, accompagnées d’annotations collectives.

**Site : https://kithain.github.io/Compendium-Memoriae/**

## Utilisation

Connectez-vous avec votre nom de joueur et votre mot de passe Dice-Forge, puis entrez le code d’un salon de votre campagne. Le compte est commun aux deux applications ; la connexion à Compendium est indépendante.

Le MJ voit les brouillons, crée et modifie les fiches, puis décide lesquelles publier. Les joueurs voient uniquement les fiches publiées et ajoutent leurs annotations. Chacun peut modifier ses propres annotations ; le texte officiel reste réservé au MJ. Les fiches et notes sont partagées entre les salons rattachés à la même campagne.

Les vues Lieux et PNJ disposent de deux défilements indépendants : la liste de navigation et le panneau de fiche, qui contient aussi les annotations. Le défilement reste dans le panneau utilisé, même à sa fin. La fiche sélectionnée reste surlignée ; sélectionner une nouvelle fiche remet uniquement son panneau de lecture en haut. Sur mobile, les panneaux sont empilés, ou placés côte à côte dans les petites fenêtres en paysage.

Le bouton **Supprimer**, en bas de la fiche à côté de **Modifier la fiche**, est réservé au MJ. Une confirmation affiche le nom de la fiche avant de la déplacer dans la **Corbeille**. Les joueurs perdent l’accès à la fiche, à ses annotations et à son image. Le MJ peut la récupérer avec **Restaurer en brouillon** ; les annotations et l’image sont conservées, et la fiche doit être republiée explicitement. Les numéros de version protègent aussi la suppression et la restauration contre les modifications concurrentes. Un nouvel import ne recrée pas une fiche encore dans la corbeille.

Les illustrations associées s’affichent dans leur fiche au format 4:3 (400 × 300). Elles sont conservées dans le bucket privé Supabase `compendium-images` et héritent des droits de la fiche : le MJ voit les brouillons, les membres de la campagne voient les images des fiches publiées. Le navigateur les télécharge avec sa session puis affiche un objet Blob temporaire.

Les fichiers placés localement dans `public/images/` sont des sources de travail : ce dossier est ignoré par Git et Vite ne le publie pas. Les associations et les fichiers de transfert restent dans `.private/` ; ni les illustrations privées ni la liste des personnages ne sont incluses dans les fichiers statiques du site.

## Données et accès

Le site est un frontend statique hébergé sur GitHub Pages. Les données sont stockées dans le projet Supabase de Dice-Forge, dans le schéma privé `compendium`. Aucun contenu de campagne n’est livré dans le dépôt ou dans les fichiers du site.

Les fonctions `cm_*` vérifient l’utilisateur et ses droits côté PostgreSQL. Le MJ est le propriétaire de la campagne présent dans `diceforge_v2.mj_users`. Les joueurs doivent déjà appartenir à un salon de cette campagne dans Dice-Forge. Connaître un code de salon ou un identifiant de fiche ne donne pas accès aux brouillons. Les écritures utilisent un numéro de version pour éviter de remplacer une modification concurrente.

La configuration du navigateur contient uniquement l’URL Supabase et une clé publique. N’y ajoutez jamais de clé `service_role`, de jeton administrateur ou de mot de passe. Les mots de passe sont traités par Supabase Auth ; cette application ne les conserve pas. Supabase conserve la session de connexion dans le navigateur.

## Développement

Node.js 24 est utilisé dans GitHub Actions.

```sh
npm ci
npm run dev
npm test
npm run build
```

Vite utilise le chemin `/Compendium-Memoriae/`, adapté au dépôt GitHub Pages. Les variables facultatives `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` permettent d’utiliser un autre environnement (voir `.env.example`).

Les tests PostgreSQL tournent localement avec PGlite et des campagnes fictives. Ils vérifient les accès, la séparation des campagnes, les brouillons, l’auteur des notes, les conflits de version et l’import transactionnel.

## Installation sur un autre projet

Le schéma Dice-Forge (`diceforge_v2.campaigns`, `campaign_rooms`, `mj_users`, `public.room_members` et Supabase Auth) doit déjà être installé. Appliquez ensuite `supabase/schema.sql` : il ajoute uniquement les tables et fonctions Compendium. Il ne recrée pas les tables Dice-Forge.

Pour les illustrations, appliquez ensuite `supabase/images.sql` une fois. Ce complément ajoute la référence d’image et le bucket privé avec sa politique de lecture. Les imports de fichiers sont réalisés par l’administrateur ; les clients du site disposent uniquement du droit de lecture des images autorisées. Utilisez une clé d’objet distincte pour chaque campagne et fiche. Une modification du texte conserve la référence d’image existante.

Appliquez enfin `supabase/deletion.sql` pour la corbeille, après les deux scripts précédents. Ce complément ajoute `deleted_at`, les fonctions de suppression/restauration et le filtrage des fiches supprimées dans toutes les lectures, écritures et autorisations d’images. L’application utilise une suppression récupérable ; aucun bouton ne purge définitivement les contenus.

Le MJ peut importer un export JSON privé depuis le bouton « Importer des fiches en brouillon » en bas de l’écran, qui ouvre une fenêtre dédiée. Chaque objet contient `id` (UUID), `type` (`place` ou `npc`), `name`, `subtitle`, `location`, `summary` et `description`. Toutes les fiches importées démarrent privées. Un nouvel import ignore les identifiants déjà présents et préserve leurs modifications et annotations. Les exports restent hors du dépôt, dans `.private/` par exemple.

## Publication

Dans GitHub, choisissez **Settings → Pages → Source → GitHub Actions**. Chaque push sur `main` lance les tests et la compilation, puis publie le dossier `dist`. Le workflow se trouve dans `.github/workflows/pages.yml`.
