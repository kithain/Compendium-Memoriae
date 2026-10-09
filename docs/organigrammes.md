# Organigrammes dans Obsidian et le Compendium

Le même texte de callouts forme les cadres, les rangées et les flèches dans les deux lecteurs. Le format reste modifiable dans une note Markdown. Le contenu reste dans la note et dans les données de la fiche ; les exemples de cette documentation sont fictifs.

## Dans Obsidian

Copier `organigrammes.css` dans le dossier `.obsidian/snippets/` du coffre, puis activer **organigrammes** dans **Paramètres → Apparence → Extraits CSS**. Le coffre équipé dispose déjà du fichier et de son activation. Le rendu s'affiche en mode Lecture et dans l'aperçu en direct ; le mode Source montre le Markdown.

Créer un callout racine `organigramme`, puis citer chaque callout enfant avec un `>` supplémentaire. Les titres et descriptions utilisent du texte simple. Exemple :

```markdown
> [!organigramme] Administration du Port
> > [!autorite] CONSEIL DU PORT
> > Fixe les règles communes.
>
> > [!organigramme-fleche] ↓
>
> > [!autorite-principale] INTENDANT
> > Nomme les responsables et applique les décisions.
>
> > [!organigramme-fleche] ↓
>
> > [!organigramme-ligne]
> > > [!autorite] CAPITAINERIE
> > > Organise les arrivées.
> >
> > > [!autorite] GREFFE
> > > Conserve les registres.
>
> > [!organigramme-groupe] SERVICES ASSOCIÉS
> > Les deux services coopèrent selon leurs compétences.
> >
> > > [!organigramme-ligne]
> > > > [!autorite] COMMISSION DU MARCHÉ
> > > > Gère les échanges.
> > >
> > > > [!autorite] COMMISSION DES QUAIS
> > > > Organise les entrepôts.
>
> > [!organigramme-fleche] ↕
> > Coordination entre services
>
> > [!autorite-arbitrage] CHAMBRE DE MÉDIATION
> > Arbitre les désaccords de compétence.
>
> > [!organigramme-note]
> > Chaque service conserve son domaine de responsabilité.
```

| Type | Présentation |
| --- | --- |
| `organigramme` | Cadre racine et titre de l'organigramme. |
| `autorite` | Cadre d'une institution, avec titre et description. |
| `autorite-principale` | Institution mise en valeur par un fond gris. |
| `autorite-arbitrage` | Institution d'arbitrage sur un fond doré discret. |
| `organigramme-ligne` | Rangée de cadres qui passe en une colonne sur téléphone. |
| `organigramme-groupe` | Groupe de compétences ; le titre s'affiche lorsqu'il contient des rangées. Sans rangée, le groupe forme un cadre commun pour ses institutions. |
| `organigramme-fleche` | Symbole de flèche dans le titre, avec libellé facultatif dans le corps. |
| `organigramme-note` | Précision sous le schéma. |

Les titres peuvent être en majuscules comme dans l'exemple. Une ligne vide citée (`>`, `> >`, etc.) sépare les callouts voisins. Conserver les niveaux de citation : `> > >` place une institution dans une rangée ou un groupe. Le format accepte au maximum six niveaux. Dans le Compendium, le texte et les titres restent littéraux : HTML et liens Markdown ne produisent ni balises ni liens ; seuls les types ci-dessus structurent le schéma. Un callout inconnu ou un bloc non conforme reste affiché comme texte afin de conserver son contenu.

Les informations placées avant ou après le callout racine restent ordinaires. Terminer le bloc par une ligne vide **sans** `>` pour séparer les commentaires externes du schéma.

## Préparer le texte pour le Compendium

L'outil local extrait uniquement les callouts racines `organigramme` de la note, avec leurs enfants. Il ignore le YAML, les paragraphes extérieurs et les exemples dans des blocs de code. Il partage les règles de validation du lecteur et refuse toute extraction invalide ou supérieure à **6 000 caractères**, séparateurs compris. Il ne modifie pas la note et n'accède à aucun service réseau.

Depuis le dossier du projet, avec les dépendances de développement installées :

```powershell
node scripts/export-organigramme.mjs --note "C:\Notes\institutions.md" --output "C:\Notes\organigramme-compendium.txt"
```

Choisir un dossier de sortie privé, par exemple `.private/`, pour les informations de campagne. Le fichier `.txt` contient le Markdown à copier. Plusieurs organigrammes sont exportés dans leur ordre d'apparition. L'outil refuse de remplacer la note source et conserve une ancienne sortie en cas d'erreur de validation.

## Mettre à jour une fiche existante

1. Ouvrir la fiche avec un compte MJ, puis **Modifier la fiche**.
2. Copier le contenu du `.txt` dans **Informations révélées**. Conserver ou ajouter le texte que les joueurs doivent pouvoir lire autour du schéma, en restant sous la limite totale de 6 000 caractères du champ.
3. Passer à l’onglet **Visuel** pour vérifier la disposition avant l'enregistrement. L’organigramme y est protégé ; sa structure se modifie dans **Texte**.
4. **Enregistrer**. L'état de publication existant est conservé ; l'enregistrement ne publie pas un brouillon.

L'import JSON est additif : il ignore les identifiants de fiches déjà présents. Il ne convient donc pas pour mettre à jour cette présentation dans une fiche existante. Passer par son formulaire d'édition conserve son identifiant, son illustration et ses annotations.

Le déploiement du code du lecteur est une opération distincte de l'enregistrement et de la publication des fiches. Enregistrer le texte ne met pas en ligne une nouvelle version du site ; déployer le site ne publie pas les brouillons.

Pour les outils d'import locaux, `--validate` lit une description sur l'entrée standard et renvoie du JSON avec `valid`, `diagramCount`, `errors` et `plainText` (les paragraphes hors organigrammes). Une validation invalide renvoie un code de sortie 1. Cette commande ne crée aucun fichier et permet de vérifier les marqueurs extérieurs au schéma avec les règles habituelles de l'import.
