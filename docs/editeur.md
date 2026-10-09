# Éditeur de fiches et d’annotations

L’éditeur propose deux onglets. **Visuel** permet de rédiger directement dans la présentation. **Texte** affiche la source Markdown, compatible avec Obsidian. Passer d’un onglet à l’autre conserve le texte enregistré. Un compteur indique la limite du champ.

La barre d’outils propose les titres, le gras, l’italique, les listes à puces ou numérotées, les liens et les tableaux. Pour mettre en forme un passage, sélectionnez-le puis choisissez l’outil. Les boutons en bas permettent d’annuler et de rétablir une modification. La source Markdown reste la valeur enregistrée.

Les organigrammes restent visibles dans l’onglet Visuel. Leur structure se modifie dans l’onglet Texte, avec la syntaxe décrite dans [organigrammes.md](organigrammes.md). Une modification de texte à côté d’un organigramme conserve sa source.

Le trombone et le glisser-déposer permettent de joindre des images PNG/JPEG/GIF/WebP/BMP/AVIF, PDF, fichiers Markdown (`.md`) et textes UTF-8 (`.txt`). La limite est de **2 Mo par fichier**, soit 2 000 000 octets, avec dix pièces jointes par fiche ou note. Un fichier vide, trop lourd, d’un autre format ou dont la signature ne correspond pas à son extension est refusé avant le dépôt. La base vérifie aussi l’extension, le type MIME, la taille finale et le propriétaire ; le bucket limite les types MIME et la taille. Comme tout stockage fondé sur un MIME annoncé, ce contrôle serveur ne décode pas lui-même les octets du fichier.

Les pièces jointes sont ajoutées au contenu lors de son enregistrement. Un échec conserve le texte et les fichiers pour réessayer. Dans une note, un texte non vide est requis. **Retirer** un fichier déjà enregistré le détache à la prochaine sauvegarde ; retirer un nouveau fichier ou abandonner le brouillon nettoie sa réservation et son objet. Le bouton **Télécharger** récupère un fichier privé avec la session. Aucun fichier n’est exposé par une URL publique.

Chaque joueur peut modifier les pièces jointes de ses propres notes ; les fichiers des fiches suivent les droits du MJ. Les membres de la campagne voient les fichiers des fiches publiées et des notes présentes. Une fiche retirée de la publication ou supprimée, un message supprimé ou un retrait de la campagne bloque les nouveaux téléchargements. Un fichier déjà téléchargé sur un appareil reste naturellement sur cet appareil. Les objets détachés d’un contenu enregistré restent conservés mais inaccessibles ; leur purge physique est une opération d’administration distincte.

Pour activer le dépôt en ligne, appliquer [attachments.sql](../supabase/attachments.sql) après les scripts existants, puis publier le frontend. L’éditeur et les essais locaux fonctionnent avec une API en mémoire sans changer la base distante.

Les liens sont limités aux adresses `https://`, `http://` et `mailto:`. Le HTML collé dans l’éditeur est ramené à son texte; il ne devient pas du code exécutable.
