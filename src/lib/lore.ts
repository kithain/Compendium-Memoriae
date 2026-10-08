import type { FicheType } from './fiches';

type LoreCategory = {
  label: string;
  singular: string;
  createLabel: string;
  newLabel: string;
  collectionTitle: string;
  searchPlaceholder: string;
  namePlaceholder: string;
  subtitleLabel: string;
  subtitlePlaceholder: string;
  locationLabel: string;
  locationPlaceholder: string;
  summaryPlaceholder: string;
  descriptionPlaceholder: string;
  emptyTitle: string;
  pageTitle: string;
};

export const loreCategories = {
  place: {
    label: 'Lieux', singular: 'Lieu', createLabel: 'Créer une fiche de lieu', newLabel: 'Nouveau lieu',
    collectionTitle: 'Les lieux connus', searchPlaceholder: 'Rechercher un lieu…', namePlaceholder: 'Le nom du lieu…',
    subtitleLabel: 'Type de lieu', subtitlePlaceholder: 'Taverne, quartier, bibliothèque…',
    locationLabel: 'Quartier ou région', locationPlaceholder: 'Ce que les personnages connaissent…',
    summaryPlaceholder: 'Deux ou trois phrases pour reconnaître le lieu.',
    descriptionPlaceholder: 'Apparence, services connus, faits découverts en partie…',
    emptyTitle: 'Le premier lieu à partager.', pageTitle: 'Les lieux de la campagne',
  },
  npc: {
    label: 'PNJ', singular: 'PNJ', createLabel: 'Créer une fiche de PNJ', newLabel: 'Nouveau PNJ',
    collectionTitle: 'Les personnages rencontrés', searchPlaceholder: 'Rechercher un personnage…', namePlaceholder: 'Le nom du personnage…',
    subtitleLabel: 'Rôle connu', subtitlePlaceholder: 'Herboriste, garde, marchande…',
    locationLabel: 'Lieu connu', locationPlaceholder: 'Ce que les personnages connaissent…',
    summaryPlaceholder: 'Deux ou trois phrases pour reconnaître le personnage.',
    descriptionPlaceholder: 'Apparence, rôle connu, faits découverts en partie…',
    emptyTitle: 'Le premier visage à retenir.', pageTitle: 'Les visages de la campagne',
  },
  faction: {
    label: 'Factions', singular: 'Faction', createLabel: 'Créer une fiche de faction', newLabel: 'Nouvelle faction',
    collectionTitle: 'Les factions connues', searchPlaceholder: 'Rechercher une faction…', namePlaceholder: 'Le nom de la faction…',
    subtitleLabel: 'Nature du groupe', subtitlePlaceholder: 'Guilde, ordre, maison, alliance…',
    locationLabel: 'Siège ou territoire', locationPlaceholder: 'Le siège ou la zone d’influence connue…',
    summaryPlaceholder: 'Deux ou trois phrases pour présenter la faction et ses objectifs connus.',
    descriptionPlaceholder: 'Objectifs, figures connues, alliances, rivalités, signes distinctifs…',
    emptyTitle: 'La première faction à découvrir.', pageTitle: 'Les factions de la campagne',
  },
  cosmogony: {
    label: 'Cosmogonie', singular: 'Cosmogonie', createLabel: 'Créer une fiche de cosmogonie', newLabel: 'Nouvelle cosmogonie',
    collectionTitle: 'Les origines et les mythes', searchPlaceholder: 'Rechercher un mythe ou une divinité…', namePlaceholder: 'Le nom du mythe, du plan ou de la divinité…',
    subtitleLabel: 'Nature du récit', subtitlePlaceholder: 'Création, divinité, plan, force primordiale…',
    locationLabel: 'Tradition ou plan associé', locationPlaceholder: 'La tradition qui transmet ce récit ou le plan concerné…',
    summaryPlaceholder: 'Deux ou trois phrases sur ce que le groupe connaît de ce mythe ou de cette entité.',
    descriptionPlaceholder: 'Origines du monde, panthéon, plans, croyances et récits transmis…',
    emptyTitle: 'Le premier mythe à transmettre.', pageTitle: 'Les origines du monde',
  },
  history: {
    label: 'Histoire', singular: 'Histoire', createLabel: 'Créer une fiche d’histoire', newLabel: 'Nouvelle histoire',
    collectionTitle: 'Les événements du passé', searchPlaceholder: 'Rechercher une époque ou un événement…', namePlaceholder: 'Le nom de l’événement ou de l’époque…',
    subtitleLabel: 'Époque ou date', subtitlePlaceholder: 'Ère ancienne, année, règne…',
    locationLabel: 'Région concernée', locationPlaceholder: 'Le lieu ou la région où ces faits se sont déroulés…',
    summaryPlaceholder: 'Deux ou trois phrases pour situer cet événement dans l’histoire du monde.',
    descriptionPlaceholder: 'Chronologie, protagonistes, causes, conséquences et traces encore visibles…',
    emptyTitle: 'Le premier événement à raconter.', pageTitle: 'La mémoire du monde',
  },
  culture: {
    label: 'Cultures', singular: 'Culture', createLabel: 'Créer une fiche de culture', newLabel: 'Nouvelle culture',
    collectionTitle: 'Les peuples et les traditions', searchPlaceholder: 'Rechercher un peuple ou une tradition…', namePlaceholder: 'Le nom du peuple ou de la tradition…',
    subtitleLabel: 'Peuple ou tradition', subtitlePlaceholder: 'Peuple, coutume, langue, fête…',
    locationLabel: 'Région ou communauté', locationPlaceholder: 'La région ou la communauté associée…',
    summaryPlaceholder: 'Deux ou trois phrases pour présenter cette culture ou cette tradition.',
    descriptionPlaceholder: 'Coutumes, langues, valeurs, rites et vie quotidienne connus…',
    emptyTitle: 'La première tradition à partager.', pageTitle: 'Les cultures du monde',
  },
  knowledge: {
    label: 'Savoirs', singular: 'Savoir', createLabel: 'Créer une fiche de savoir', newLabel: 'Nouveau savoir',
    collectionTitle: 'Les savoirs découverts', searchPlaceholder: 'Rechercher un savoir ou un mystère…', namePlaceholder: 'Le nom du savoir ou du mystère…',
    subtitleLabel: 'Domaine', subtitlePlaceholder: 'Magie, phénomène, artefact, découverte…',
    locationLabel: 'Origine ou source', locationPlaceholder: 'Le lieu, le texte ou la personne à l’origine de ce savoir…',
    summaryPlaceholder: 'Deux ou trois phrases pour présenter ce savoir et son intérêt pour le groupe.',
    descriptionPlaceholder: 'Faits établis, usages connus, limites et questions encore ouvertes…',
    emptyTitle: 'Le premier savoir à consigner.', pageTitle: 'Les savoirs de la campagne',
  },
} satisfies Record<FicheType, LoreCategory>;
