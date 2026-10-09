# Tableaux dans le Compendium et Obsidian

Les tableaux Markdown s'affichent dans **Informations révélées** et dans les notes du groupe, avec le même texte utilisable dans une note Obsidian. Le bouton **Ajouter un tableau** de la barre d'outils ajoute un modèle à la fin du champ. L'onglet **Visuel** permet de modifier les cellules directement ; **Texte** permet de modifier leur source Markdown. Vérifier le résultat dans Visuel avant **Enregistrer**.

```markdown
| Service | Fonction | Effectif |
| :--- | :---: | ---: |
| Greffe | Registres | 4 |
| Capitainerie | Accueil | 12 |
```

Chaque ligne représente une rangée ; les caractères `|` séparent ses cellules. Ajouter une ligne pour ajouter une rangée. Pour ajouter une colonne, ajouter sa cellule à chaque ligne, y compris à l'en-tête et au séparateur. Conserver le même nombre de cellules partout. Une ligne vide avant et après le tableau le sépare du texte environnant.

Le séparateur sous l'en-tête est obligatoire. `:---` aligne une colonne à gauche, `:---:` au centre et `---:` à droite ; `---` utilise l'alignement à gauche. Pour écrire un caractère `|` dans une cellule, utiliser `\|`.

Les cellules acceptent le gras (`**gras**`), l'italique (`*italique*`), le code et les liens Markdown. Le HTML reste affiché littéralement. Les textes longs passent à la ligne. Un tableau large défile horizontalement dans son propre cadre, sans élargir la page.

Le champ conserve sa limite de **6 000 caractères**, texte et tableaux compris. Un tableau accepte au maximum **20 colonnes** et **200 lignes de données**, en plus de l'en-tête. Un bloc incomplet ou non conforme reste affiché comme texte pour conserver son contenu.

L'enregistrement et la publication suivent les règles habituelles des fiches : enregistrer une modification conserve l'état existant ; un brouillon doit être publié explicitement pour être visible aux joueurs. Mettre à jour le code du site reste une opération distincte.
