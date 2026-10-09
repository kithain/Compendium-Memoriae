# Compendium Memoriae

Fiches de lore partagées avec les joueurs, accompagnées d’annotations collectives : lieux, PNJ, factions, cosmogonie, histoire, cultures et savoirs.

**Site : https://kithain.github.io/Compendium-Memoriae/**

## Utilisation

Connectez-vous avec votre nom de joueur et votre mot de passe Dice-Forge : la campagne **Valombre** s’ouvre directement. Une session déjà ouverte donne également accès aux fiches sans étape supplémentaire. Le compte est commun aux deux applications ; la connexion à Compendium est indépendante.

En cas d’erreur pendant l’ouverture, **Réessayer** relance le chargement. **Déconnexion** permet de changer de compte. Les droits restent vérifiés par le serveur pour chaque utilisateur.

Le MJ voit les brouillons, crée et modifie les fiches, puis décide lesquelles publier. Les joueurs voient uniquement les fiches publiées et ajoutent leurs annotations. Chacun peut modifier ou supprimer ses propres annotations ; le texte officiel reste réservé au MJ. Les fiches et notes sont partagées entre les salons rattachés à la même campagne.

Les onglets **Lieux**, **PNJ**, **Factions**, **Cosmogonie**, **Histoire**, **Cultures** et **Savoirs** organisent les fiches par thème. Chaque catégorie dispose des mêmes fonctions : création en brouillon, édition, publication, recherche, notes du groupe, illustration, suppression et restauration. Sur un petit écran, la barre d’onglets défile horizontalement pour garder toutes les catégories accessibles ; les libellés restent visibles même lorsque les icônes et les compteurs sont masqués.

Dans le formulaire MJ, **Catégorie du lore** permet de choisir le thème d’une nouvelle fiche ou de reclasser une fiche existante. Après l’enregistrement, son onglet s’ouvre sur la fiche. Le reclassement conserve son état de publication, ses annotations et son illustration.

La corbeille à côté d’une annotation ouvre une confirmation de suppression. Seul son auteur dispose de cette action, y compris côté serveur : le MJ ne peut pas supprimer les messages des autres joueurs. Le texte est effacé et remplacé par **« Message supprimé par l’utilisateur. »**, avec l’auteur et la date conservés. Cette suppression ne peut pas être annulée ; la trace reste à sa place dans la conversation et ne peut plus être modifiée. Les autres brouillons en cours restent intacts.

La section **Notes du groupe** présente les messages dans une liste compacte : auteur, date discrète et texte complet. Les boutons de modification et de suppression restent à côté des messages de leur auteur. Le champ **Écrire une note…** tient sur deux lignes et conserve la possibilité de s’agrandir.

Toutes les vues de lore disposent de deux défilements indépendants : la liste de navigation et le panneau de fiche, qui contient aussi les annotations. Le défilement reste dans le panneau utilisé, même à sa fin. La fiche sélectionnée reste surlignée ; sélectionner une nouvelle fiche remet uniquement son panneau de lecture en haut. Sur mobile, **Choisir une fiche** ouvre la liste au-dessus du lecteur. Elle se replie après une sélection pour libérer l’espace de lecture, puis retrouve la fiche active à sa réouverture. Les petites fenêtres en paysage conservent les deux colonnes.

La lecture n’est pas interrompue par une actualisation périodique ou au retour sur l’onglet. Le bouton **Actualiser les fiches**, à côté du titre de la liste, récupère les changements des autres membres de la campagne. Vos enregistrements et imports mettent immédiatement à jour les données affichées.

Le bouton **Supprimer**, en bas de la fiche à côté de **Modifier la fiche**, est réservé au MJ. Une confirmation affiche le nom de la fiche avant de la déplacer dans la **Corbeille**. Les joueurs perdent l’accès à la fiche, à ses annotations et à son image. Le MJ peut la récupérer avec **Restaurer en brouillon** ; les annotations et l’image sont conservées, et la fiche doit être republiée explicitement. Les numéros de version protègent aussi la suppression et la restauration contre les modifications concurrentes. Un nouvel import ne recrée pas une fiche encore dans la corbeille.

Les illustrations associées s’affichent dans leur fiche au format 4:3 (400 × 300). Elles sont conservées dans le bucket privé Supabase `compendium-images` et héritent des droits de la fiche : le MJ voit les brouillons, les membres de la campagne voient les images des fiches publiées. Le navigateur les télécharge avec sa session puis affiche un objet Blob temporaire.

Les fichiers placés localement dans `public/images/` sont des sources de travail : ce dossier est ignoré par Git et Vite ne le publie pas. Les associations et les fichiers de transfert restent dans `.private/` ; ni les illustrations privées ni la liste des personnages ne sont incluses dans les fichiers statiques du site.

Les informations révélées peuvent contenir des organigrammes éditables au format des callouts Obsidian. Les cadres, les rangées et les flèches se mettent en forme dans le lecteur et dans l’onglet **Visuel** de l’éditeur. Leur structure se modifie dans l’onglet **Texte**. Voir [le modèle et l’outil d’export](docs/organigrammes.md).

Les tableaux Markdown sont pris en charge dans **Informations révélées** et les notes du groupe. **Ajouter un tableau** ajoute un modèle à la fin du texte ; les cellules sont modifiables dans **Visuel**, la structure dans **Texte**. Les tableaux larges défilent dans leur cadre. Voir [le format et les exemples](docs/tableaux.md).

Les fiches MJ et les notes des joueurs utilisent une barre de rédaction avec titres, gras, italique, listes, liens, tableaux et historique. Le trombone et le glisser-déposer acceptent les images PNG/JPEG/GIF/WebP/BMP/AVIF, les PDF, les fichiers `.md` et `.txt`, avec **2 Mo maximum par fichier** (2 000 000 octets) et dix pièces jointes par contenu. Les fichiers restent dans le bucket privé `compendium-attachments` ; leur accès suit la visibilité de la fiche et la présence du message. Les fichiers déposés avant l’enregistrement sont réservés à leur auteur. Voir [le guide de l’éditeur](docs/editeur.md).

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

Vite utilise le chemin `/Compendium-Memoriae/`, adapté au dépôt GitHub Pages. Les variables facultatives `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` permettent d’utiliser un autre environnement (voir `.env.example`). `VITE_CAMPAIGN_ROOM` définit le salon utilisé automatiquement pour retrouver la campagne, avec `4SSU` par défaut. Ce code ne remplace pas les contrôles d’accès : les joueurs doivent déjà appartenir à un salon de la campagne dans Dice-Forge.

Les tests PostgreSQL tournent localement avec PGlite et des campagnes fictives. Ils vérifient les accès, la séparation des campagnes, les brouillons, l’auteur des notes, les conflits de version, la suppression des annotations et l’import transactionnel. Les vérifications des petits écrans sont décrites dans [docs/verification-interface.md](docs/verification-interface.md).

## Installation sur un autre projet

Le schéma Dice-Forge (`diceforge_v2.campaigns`, `campaign_rooms`, `mj_users`, `public.room_members` et Supabase Auth) doit déjà être installé. Appliquez ensuite `supabase/schema.sql` : il ajoute uniquement les tables et fonctions Compendium. Il ne recrée pas les tables Dice-Forge.

Pour les illustrations, appliquez ensuite `supabase/images.sql` une fois. Ce complément ajoute la référence d’image et le bucket privé avec sa politique de lecture. Les imports de fichiers sont réalisés par l’administrateur ; les clients du site disposent uniquement du droit de lecture des images autorisées. Utilisez une clé d’objet distincte pour chaque campagne et fiche. Une modification du texte conserve la référence d’image existante.

Appliquez ensuite `supabase/deletion.sql` pour la corbeille, après les deux scripts précédents. Ce complément ajoute `deleted_at`, les fonctions de suppression/restauration et le filtrage des fiches supprimées dans toutes les lectures, écritures et autorisations d’images. Les fiches utilisent une suppression récupérable ; aucun bouton ne les purge définitivement.

Appliquez ensuite `supabase/annotations.sql` pour permettre à l’auteur d’effacer le texte de ses propres messages tout en conservant une trace. Ce script ajoute `annotations.deleted_at`, la fonction `cm_delete_annotation` et les protections contre la modification d’un message déjà supprimé. Le numéro de version protège aussi cette action des modifications concurrentes.

Appliquez ensuite `supabase/lore-types.sql`, après `supabase/annotations.sql`, pour autoriser les sept catégories de lore. Ce complément met à jour la contrainte des types ainsi que leur validation lors de l’enregistrement et de l’import. Il est nécessaire sur un projet existant pour créer ou importer les nouvelles catégories ; les fiches de lieux et de PNJ conservent leur type.

Appliquez enfin `supabase/attachments.sql` pour activer les pièces jointes. Le script ajoute les réservations, les fonctions de sauvegarde avec fichiers, le bucket privé limité à 2 Mo et ses droits de dépôt/lecture/nettoyage. Il peut être réexécuté. Les anciens appels sans fichiers restent compatibles. Aucun fichier de campagne n’est livré dans le frontend ; les téléchargements passent par la session et un Blob local, sans URL publique.

Le MJ peut importer un export JSON privé depuis le bouton « Importer des fiches en brouillon » en bas de l’écran, qui ouvre une fenêtre dédiée. Chaque objet contient `id` (UUID), `type`, `name`, `subtitle`, `location`, `summary` et `description`. Le champ `type` accepte les valeurs suivantes :

| Onglet | Valeur JSON de `type` |
| --- | --- |
| Lieux | `place` |
| PNJ | `npc` |
| Factions | `faction` |
| Cosmogonie | `cosmogony` |
| Histoire | `history` |
| Cultures | `culture` |
| Savoirs | `knowledge` |

Un même fichier peut mélanger ces catégories. Toutes les fiches importées démarrent privées. Un nouvel import ignore les identifiants déjà présents et préserve leurs modifications et annotations. Les exports restent hors du dépôt, dans `.private/` par exemple.

## Publication

Pour envoyer manuellement vos modifications locales sous Windows, double-cliquez sur **publier.cmd** à la racine du projet. Le script affiche les fichiers concernés et la destination, demande le message du commit puis une confirmation. Il ajoute les créations, modifications et suppressions non ignorées par Git, crée le commit et l’envoie sur `origin/main`. S’il reste un commit local à envoyer après un précédent échec, vous pouvez simplement relancer le script.

Le script vérifie d’abord la branche distante. Si GitHub contient de nouveaux commits, il s’arrête pour vous laisser récupérer les changements. Il ne lance pas de pull automatique et n’utilise pas de push forcé. Une erreur d’envoi conserve le commit local.

Pour consulter les fichiers concernés sans modifier Git ni contacter GitHub :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\commit-push.ps1 -Preview
```

Le lanceur utilise une autorisation d’exécution limitée à son processus PowerShell ; il ne modifie pas la politique Windows enregistrée. Les scripts sont également utilisables depuis PowerShell, avec le paramètre facultatif `-Message "Description des changements"`.

Cette publication concerne les fichiers du site. Les fiches et annotations enregistrées en ligne sont déjà dans Supabase. Les dossiers `.private/`, `public/images/`, `node_modules/`, `dist/` et les fichiers `.env` restent ignorés ; les images privées ne sont pas publiées sur GitHub.

Dans GitHub, choisissez **Settings → Pages → Source → GitHub Actions**. Chaque push sur `main` lance les tests et la compilation, puis publie le dossier `dist`. Le workflow se trouve dans `.github/workflows/pages.yml`.
