# Vérification de l’interface

Vérification du 7 octobre 2026 dans un navigateur Chromium, avec des dimensions de fenêtre simulées et des données fictives. Aucun message réel n’a été supprimé pour ces essais.

Les sections historiques ci-dessous décrivent les essais effectués avant l’ajout des cinq nouvelles catégories de lore. Elles portent sur Lieux et PNJ. Les essais ciblés des sept onglets, effectués le 8 octobre 2026, et la matrice complète restant à couvrir figurent séparément en fin de document.

## Formats vérifiés

Chaque format a été vérifié en espace MJ et en espace joueurs, sur les vues Lieux et PNJ : **28 combinaisons**.

| Format | Dimensions CSS | Résultat |
| --- | --- | --- |
| Ordinateur | 1280 × 720 | Conforme |
| Petit ordinateur | 1024 × 600 | Conforme |
| Tablette portrait | 768 × 1024 | Conforme |
| Smartphone portrait | 390 × 844 | Conforme |
| Smartphone compact | 360 × 640 | Conforme |
| Petit smartphone | 320 × 568 | Conforme |
| Smartphone paysage | 667 × 375 | Conforme |

Pour chaque combinaison : recherche active, défilement au bas de la liste, défilement supplémentaire à sa limite, déplacement du lecteur, sélection de la dernière fiche et identification de l’élément actif. La liste et le lecteur gardent des positions indépendantes, la page ne défile pas et aucun débordement horizontal n’apparaît. Le lecteur reste visible quand la liste est ouverte.

En portrait mobile, la liste se replie après la sélection et le focus clavier passe au lecteur. Sa réouverture ramène uniquement la liste sur la fiche active. Les fiches peuvent alors utiliser davantage de hauteur : à 320 × 568, le lecteur occupe environ 236 px en espace MJ et 324 px en espace joueurs. Sur les formats compacts, la liste ouverte sert surtout à choisir la prochaine fiche ; la refermer rend l’espace de lecture plus confortable.

Les boutons d’annotation, d’actualisation et de compte ont une cible d’au moins 44 × 44 px aux largeurs jusqu’à 1024 px. Les champs de recherche et les champs de fiche utilisent 16 px sur ces formats. Les auteurs longs reviennent à la ligne. Les confirmations restent dans la fenêtre et défilent à l’intérieur si nécessaire.

Le formulaire de création MJ, la saisie d’annotation et la fenêtre d’import ont aussi été vérifiés à 320 px et 390 px. Les actions du formulaire sont empilées sur mobile. L’input invisible de la case de publication reste dans son conteneur : l’édition ne crée plus de barre de défilement extérieure.

## Suppression des annotations

Les parcours suivants ont été vérifiés avec des messages fictifs :

- Annuler conserve le message et ramène le focus au bouton d’origine.
- Confirmer efface le texte, conserve l’auteur et la date et affiche « Message supprimé par l’utilisateur. » sans boutons de modification ou de suppression.
- Les messages des autres auteurs restent intacts et ne présentent pas de bouton de suppression, même pour le MJ.
- Un brouillon d’une autre annotation est conservé.
- Supprimer le message actuellement en cours de modification avertit de la perte de ces modifications ; confirmer remet le formulaire en mode ajout.
- Une erreur serveur conserve le message et laisse la confirmation ouverte avec une erreur visible et le focus sur le bouton de nouvelle tentative.
- Après une suppression réussie, le focus revient au panneau de lecture.

La suite PostgreSQL comprend **45 tests**, dont 17 consacrés à la suppression des annotations : auteur, séparation des campagnes, droits des joueurs et du MJ, versions concurrentes, fiches privées ou supprimées, texte effacé en base et impossibilité de modifier la trace. Les tests utilisent PGlite et des campagnes fictives.

## Présentation compacte des notes

La section affiche désormais un seul titre « Notes du groupe ». Le sous-titre décoratif, le pictogramme de section, la phrase d’aide, les avatars et la signature répétée sous le formulaire ont été retirés. Les notes conservent leur auteur, une date courte et leur texte intégral ; la date avec son heure et son éventuel statut de modification/suppression reste disponible dans le libellé accessible et au survol. Le formulaire commence sur deux lignes et reste redimensionnable.

Comparaison avec les trois mêmes messages fictifs, dont un message long et un auteur long :

| Fenêtre | Hauteur avant | Hauteur après | Espace libéré |
| --- | --- | --- | --- |
| 1024 × 600 | 1024 px | 565 px | 459 px |
| 390 × 844 | 1308 px | 762 px | 546 px |
| 320 × 568 | 1661 px | 788 px | 873 px |

Le titre passe à environ 25 px de hauteur et le formulaire à 124 px. Ces mesures portent sur la section entière défilante ; sa hauteur dépend toujours du contenu des messages.

Les 28 combinaisons de formats, rôles et vues ont été revérifiées : texte et saisie à 16 px, boutons tactiles de 44 px jusqu’à 1024 px, auteurs longs sans débordement, page contenue dans la fenêtre et conservation des deux défilements. Les parcours d’ajout, d’édition et de suppression d’une note fictive, ainsi que la protection du brouillon lors d’un changement de vue, ont été vérifiés avec les nouveaux libellés.

## Ouverture directe de la campagne

La connexion ouvre Valombre directement, sans formulaire de salon ni bouton « Campagnes ». Le salon configuré `4SSU` est résolu par la RPC existante `cm_context`, qui conserve ses contrôles d’accès. Aucune migration n’est nécessaire. Le projet DiceForge contient d’autres campagnes vides ; seule Valombre contient des fiches Compendium. Cette ouverture vise explicitement la campagne configurée.

Les essais suivants ont été réalisés avec les composants réels et des services fictifs, sans connexion à un compte réel ni requête de données de campagne :

- Connexion depuis le formulaire, puis ouverture directe des fiches et déconnexion vers le formulaire.
- Session déjà ouverte en espace joueur et en espace MJ.
- Renouvellement de session sans rechargement de la campagne ni des listes.
- Refus d’accès affiché sans formulaire de salon.
- Erreur réseau suivie d’une nouvelle tentative réussie.
- Déconnexion pendant le chargement : la réponse tardive n’affiche pas les fiches.
- Changement de compte pendant le chargement : la réponse du compte précédent est ignorée.
- Fin tardive d’une ancienne déconnexion : le nouveau compte reste ouvert.
- Erreur de déconnexion : la fiche reste affichée et l’erreur est visible.

Ces parcours ont été vérifiés à 390 × 844 ; l’ouverture directe a également été vérifiée dans une fenêtre de bureau. La compilation TypeScript et Vite passe. Les **14 tests de sécurité** de `tests/security.test.mjs` passent, notamment les sessions absentes, les identités falsifiées, les droits MJ/joueurs et la séparation des campagnes. Le contrôle en lecture seule du projet déployé confirme que `4SSU` correspond à Valombre et que `cm_context` est accessible à `authenticated`, pas à `anon`.

## Contrôle du schéma déployé

La migration `compendium_author_annotation_deletion` a été appliquée au projet DiceForge. Vérifications : RPC indisponible pour `anon`, disponible pour `authenticated`, aucun droit direct de modification sur la table privée, fonction de sérialisation privée non exposée et contrainte imposant le texte de remplacement aux messages supprimés.

Les conseillers Supabase signalent les fonctions publiques `SECURITY DEFINER` accessibles à `authenticated`. C’est le fonctionnement voulu pour `cm_save_annotation` et `cm_delete_annotation` : les tables restent privées et les fonctions contrôlent explicitement la session, l’appartenance à la campagne, la visibilité de la fiche, l’auteur et la version. Leur `search_path` est vide. Voir [la notice du conseiller et ses remédiations](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

La notice informative « RLS activée sans politique » sur les tables privées `compendium.fiches` et `compendium.annotations` est également attendue : les clients n’ont aucun droit direct et passent par ces RPC. Voir [la notice RLS et ses remédiations](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Catégories de lore : schéma déployé le 8 octobre 2026

La migration `compendium_lore_categories`, correspondant au complément `supabase/lore-types.sql`, a été appliquée au projet Dice Forge `bwrylcvkplonkfhnegvm`.

Le contrôle avant et après migration conserve les mêmes empreintes pour les **140 fiches**, les **2 annotations** et les définitions des fonctions publiques `cm_*`. Les contenus existants et les contrôles d’accès de ces RPC restent donc inchangés. La fonction de validation des types est privée ; elle accepte `place`, `npc`, `faction`, `cosmogony`, `history`, `culture` et `knowledge`. Ce dernier contrôle a appelé la fonction sans enregistrer de fiche.

Les avis Compendium de niveau INFO « RLS activée sans politique » restent identiques : les tables privées sont toujours accessibles aux clients uniquement par les RPC prévues. La suite complète des tests du projet passe : **72 tests**.

## Sept onglets de lore : essais ciblés du 8 octobre 2026

Essais automatisés avec Playwright et Chromium headless, sur le composant `Compendium` réel servi par Vite. L’API est remplacée par des données en mémoire : trois fiches fictives par catégorie, dont un brouillon, des notes fictives et une illustration SVG synthétique. Toutes les requêtes hors loopback sont bloquées. Aucun compte réel, contenu de campagne ou projet Supabase n’a été utilisé.

Les parcours suivants passent :

- À 1280 × 720 en espace MJ, présence des sept onglets, sélection de chaque catégorie, recherche d’une fiche et affichage de la fiche sélectionnée.
- Création d’un brouillon dans Factions, reclassement vers Cosmogonie via **Catégorie du lore**, ouverture automatique de l’onglet cible et retrait de la fiche de son ancien onglet.
- Changement d’onglet avec une fiche ou une annotation non enregistrée : la confirmation conserve le contenu lorsqu’on continue à écrire, ou permet la navigation après abandon.
- En rôle joueur et dans l’aperçu joueur du MJ à 1280 × 720, seuls les deux exemples publiés de chaque catégorie apparaissent ; le formulaire de modification MJ est absent dans le rôle joueur.
- À 390 × 844 et 320 × 568 en espace MJ, accès aux sept catégories, recherche et sélection d’une fiche, puis repli de la liste mobile.
- Sur ces deux formats mobiles, navigation des onglets par les touches Début, Fin et Flèche droite ; l’onglet Savoirs reste entièrement visible après activation au clavier. La barre défile horizontalement et la page reste contenue dans la largeur de la fenêtre.

| Format | Largeur visible de la barre | Largeur défilante | Défilement vers Savoirs | Largeur de la page |
| --- | --- | --- | --- | --- |
| 390 × 844 | 359 px | 528 px | 169 px | 390 px |
| 320 × 568 | 294 px | 528 px | 234 px | 320 px |

Aucune erreur d’exécution du navigateur ni tentative de requête hors loopback n’a été relevée. Le harness et le script restent locaux dans `.private/lore-preview.html`, `.private/lore-preview.tsx` et `.private/lore-ui-check.mjs`.

## Sept onglets de lore : matrice complète à couvrir

Reprendre les sept formats du tableau en espace MJ et en espace joueur, pour **Lieux**, **PNJ**, **Factions**, **Cosmogonie**, **Histoire**, **Cultures** et **Savoirs** : **98 combinaisons** dans la matrice complète. Les essais ciblés précédents ne valident pas cette matrice entière. Pour les essais avec une base dédiée, appliquer au préalable `supabase/lore-types.sql` après `supabase/annotations.sql` sur l’environnement d’essai.

- À 320 px et 390 px, atteindre les sept onglets par défilement horizontal, sans créer de débordement horizontal de la page. Vérifier aussi le défilement tactile ou au pointeur.
- Parcourir les onglets au clavier et vérifier que l’onglet focalisé reste visible, que son libellé est accessible et que l’état sélectionné est identifiable. Les icônes et compteurs peuvent être masqués sur mobile ; les noms des catégories doivent rester lisibles.
- Ouvrir chaque catégorie, vérifier le filtrage des fiches et la recherche, puis sélectionner une fiche et retrouver sa surbrillance. Vérifier que la sélection et les résultats appartiennent bien à l’onglet courant.
- Reprendre les contrôles de défilement indépendant de la liste et du lecteur, ainsi que l’ouverture, le repli et la réouverture de **Choisir une fiche** en portrait mobile.
- En espace MJ, créer, modifier et publier une fiche de chaque catégorie ; vérifier son affichage dans l’espace joueur. Contrôler aussi les catégories vides et les brouillons invisibles aux joueurs.
- Ajouter, modifier et supprimer une annotation fictive dans chaque catégorie, puis vérifier la conservation d’un brouillon de note lors d’un changement d’onglet.
- Vérifier une illustration autorisée dans chaque catégorie, la suppression de sa fiche et sa restauration en brouillon : notes et image conservées, accès joueur rétabli seulement après republication.
- Importer un JSON fictif comprenant les sept valeurs `place`, `npc`, `faction`, `cosmogony`, `history`, `culture` et `knowledge`. Vérifier le classement des fiches, leur état privé, le rejet d’un type inconnu et la conservation des fiches déjà présentes lors d’un nouvel import.
- À 320 px et 390 px, vérifier que les formulaires de création, les confirmations et la fenêtre d’import restent dans la fenêtre, avec des cibles tactiles et un focus visibles.

## Organigrammes : vérification du 8 octobre 2026

Le lecteur et l’aperçu du formulaire utilisent le même rendu pour les callouts Obsidian. Les huit tests du parseur et les six tests de l’outil d’export portent sur la hiérarchie, les blocs multiples, la conservation du texte ordinaire, les limites, les formats incorrects et le contenu HTML affiché comme texte. La suite complète passe : **86 tests**. TypeScript et la compilation Vite passent également.

Les contrôles Playwright utilisent le composant réel avec une API en mémoire, sans session ni client Supabase. Le schéma provient d’un export local ; il reste hors du code publié. Toutes les requêtes hors loopback sont bloquées. Aucune erreur d’exécution ni requête extérieure n’a été relevée.

- À 1280 × 900, les rangées ont deux colonnes ; à 390 × 844 et 320 × 568, elles passent à une seule colonne sans débordement horizontal.
- Le texte avant et après le schéma reste visible. Les flèches, les groupes et les descriptions restent dans leur cadre.
- Dans le formulaire, l’aperçu suit une modification du texte avant l’enregistrement. Enregistrer conserve le schéma, les paragraphes extérieurs et l’état de brouillon.
- Le CSS du coffre et celui du site sont identiques. L’extrait est activé dans la configuration du coffre ; le rendu dans l’application Obsidian elle-même n’a pas été contrôlé visuellement.

Le harness, l’export, les résultats et les captures restent dans `.private/organigrammes-*` et `.private/organigramme-*`. Aucun contenu de fiche en ligne n’a été remplacé et aucune nouvelle version du site n’a été publiée pendant ces essais.

## Tableaux : vérification du 8 octobre 2026

Les tableaux Markdown utilisent le même composant dans le lecteur et l’aperçu du formulaire. Les sept tests du parseur couvrent les alignements, les cellules vides, les séparateurs échappés, les retours CRLF, les blocs multiples, les exemples clôturés et les limites. Trois tests de rendu vérifient la coexistence avec un organigramme et du texte, le HTML affiché littéralement et la conservation complète d’un tableau incorrect. La suite complète passe : **96 tests**. TypeScript et la compilation Vite passent également.

Le composant réel a été contrôlé avec des données fictives et une API en mémoire, sans client de base de données. Toutes les requêtes hors loopback sont bloquées ; aucune erreur d’exécution ni requête extérieure n’a été relevée.

- Le lecteur MJ a été vérifié à 1280 × 900, 390 × 844 et 320 × 568. Le lecteur joueur a été vérifié à 390 × 844. Les alignements restent corrects et les tableaux défilent horizontalement dans leur cadre sans élargir la page.
- **Ajouter un tableau** conserve le texte existant et ajoute le modèle à sa suite. Dans un champ vide, le modèle commence directement par l’en-tête. L’aperçu suit les modifications de cellules avant l’enregistrement.
- Enregistrer puis rouvrir conserve exactement le texte saisi et l’état de brouillon. Le bouton respecte la limite de 6 000 caractères, y compris à la frontière exacte.
- À 390 px et 320 px, le bouton et l’aperçu restent dans le formulaire ; le défilement horizontal du tableau fonctionne.

Le harness, les résultats et les captures restent dans `.private/tableaux-*` et `.private/tableau-*`. Les fichiers du site ont été compilés dans un dossier temporaire. Aucune donnée de fiche en ligne n’a été modifiée et aucune nouvelle version du site n’a été publiée pendant ces essais.

## Éditeur et pièces jointes : vérification du 8 octobre 2026

Les fiches MJ et les notes des joueurs utilisent l’éditeur Visuel/Texte. Les exemples historiques « Aperçu de la présentation » ci-dessus décrivent l’interface antérieure ; cet aperçu est désormais l’onglet **Visuel**. Les trois tests de validation de fichiers, les six tests de mise en forme et les quatorze tests PostgreSQL des pièces jointes s’ajoutent aux tests précédents. La suite complète passe : **119 tests**. TypeScript et la compilation Vite passent également.

Les essais navigateur utilisent le composant réel avec des fichiers fictifs et une API en mémoire. Ils ont vérifié :

- Les bascules Visuel/Texte sans modification de la source CRLF, le gras, l’annulation/rétablissement, l’édition directe d’une cellule et l’enregistrement d’une fiche MJ avec fichier Markdown.
- La conservation de la source d’un organigramme lors d’une modification voisine ; une suppression visuelle de sa carte ou une insertion de lien dans une sélection qui le traverse sont refusées. Les liens avec des parenthèses et les sauts de ligne terminaux restent conservés.
- Le dépôt des quatre familles de fichiers dans une note de joueur, l’enregistrement, le téléchargement par Blob privé et le retrait d’un fichier à la prochaine sauvegarde.
- La conservation du texte et des quatre fichiers après un échec d’enregistrement simulé, puis une nouvelle tentative réussie.
- Le refus d’un fichier de 2 000 001 octets et d’un exécutable ; le glisser-déposer et le retrait d’un fichier temporaire.
- À 1280 × 1000, 390 × 844 et 320 × 568, le formulaire reste dans la page sans débordement horizontal. La barre d’outils se répartit sur plusieurs rangées sur mobile.

Les tests PGlite vérifient les autorisations des RPC et des objets Storage, les extensions/MIME, la limite de 2 000 000 octets, les métadonnées finales, les listes de fichiers sauvegardées en transaction, les conflits de version, l’isolation par campagne/auteur et les droits après suppression ou retrait de publication. Le nettoyage Storage exige d’abord l’abandon de la réservation verrouillée : un objet actif ne peut pas être effacé pendant son association au contenu. Une réexécution du script conserve les données.

Aucune erreur navigateur ni requête hors loopback n’a été relevée. Le harness, les résultats et les captures restent dans `.private/editeur-*`. Les essais ne téléversent pas de fichier sur le service Storage réel et ne constituent pas un essai distant de bout en bout. Le script `supabase/attachments.sql` est prêt à appliquer après les scripts existants ; ni la base distante ni le site publié n’ont été modifiés pendant cette tâche.

## Limites

Ces essais valident les dimensions et les interactions dans un navigateur de bureau. Ils ne remplacent pas des essais sur un appareil physique, notamment Safari iOS, le clavier virtuel, les barres du navigateur mobile et les technologies d’assistance. Les captures et les jeux de données de test restent locaux dans `.private/` et ne sont pas publiés.
