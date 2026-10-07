# Vérification des annotations et des petits écrans

Vérification du 7 octobre 2026 dans un navigateur Chromium, avec des dimensions de fenêtre simulées et des données fictives. Aucun message réel n’a été supprimé pour ces essais.

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

## Contrôle du schéma déployé

La migration `compendium_author_annotation_deletion` a été appliquée au projet DiceForge. Vérifications : RPC indisponible pour `anon`, disponible pour `authenticated`, aucun droit direct de modification sur la table privée, fonction de sérialisation privée non exposée et contrainte imposant le texte de remplacement aux messages supprimés.

Les conseillers Supabase signalent les fonctions publiques `SECURITY DEFINER` accessibles à `authenticated`. C’est le fonctionnement voulu pour `cm_save_annotation` et `cm_delete_annotation` : les tables restent privées et les fonctions contrôlent explicitement la session, l’appartenance à la campagne, la visibilité de la fiche, l’auteur et la version. Leur `search_path` est vide. Voir [la notice du conseiller et ses remédiations](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

La notice informative « RLS activée sans politique » sur les tables privées `compendium.fiches` et `compendium.annotations` est également attendue : les clients n’ont aucun droit direct et passent par ces RPC. Voir [la notice RLS et ses remédiations](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Limites

Ces essais valident les dimensions et les interactions dans un navigateur de bureau. Ils ne remplacent pas des essais sur un appareil physique, notamment Safari iOS, le clavier virtuel, les barres du navigateur mobile et les technologies d’assistance. Les captures et les jeux de données de test restent locaux dans `.private/` et ne sont pas publiés.
