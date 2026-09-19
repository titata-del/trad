# ScanMood 2.0 — vraie traduction gratuite

Application web installable sur iPhone pour traduire des scans anglais, japonais ou chinois vers le français, en conservant le ton de la scène.

## Ce qui change dans cette version

- aucun mode démo et aucune fausse traduction ;
- aucun abonnement OpenAI et aucune clé payante ;
- traduction réelle avec Cloudflare Workers AI ;
- import JPG, PNG, WEBP et PDF, jusqu’à 200 pages ;
- import par lien vers une page de chapitre, une image ou un PDF public ;
- ouverture dynamique et défilement automatique des chapitres pour charger les pages tardives ;
- import par groupes de 5 images et traduction de 3 pages en parallèle ;
- historique local des 10 derniers chapitres, avec réouverture hors ligne quand le stockage de l’iPhone le permet ;
- vues Original, Traduit et Comparer réparées ;
- mode lecture plein écran plus large ;
- lecture verticale continue : toutes les pages défilent vers le bas ;
- chargement progressif pour éviter les pages noires sur iPhone ;
- découpage automatique des très longues captures sans perte de lisibilité ;
- thème clair ou sombre dans les réglages ;
- correction manuelle des dialogues et export JPG/PDF ;
- écran de verrouillage type iPhone, code `071079`.

## Comment l’application fonctionne

GitHub Pages affiche l’application. Le petit dossier `worker` est déployé gratuitement chez Cloudflare et lit les images avec un modèle vision. L’utilisateur ne voit qu’une seule application : ScanMood.

```text
iPhone / ordinateur → GitHub Pages → Worker Cloudflare gratuit → traduction française
```

Le quota gratuit de Cloudflare est limité. Lorsqu’il est épuisé, ScanMood affiche « limite gratuite du jour atteinte » et il suffit de réessayer le lendemain. Le navigateur distant Cloudflare dispose aussi de 10 minutes gratuites par jour. Aucun paiement automatique n’est ajouté par ce projet.

## Installation

1. Publie ce dossier sur GitHub comme avant. Le workflow `.github/workflows/pages.yml` publie automatiquement `dist`.
2. Suis le fichier `ÉTAPES_CLOUDFLARE.md` pour créer le moteur gratuit.
3. Colle l’adresse obtenue dans `dist/config.js`, puis enregistre la modification sur GitHub.

Une fois ces trois étapes terminées, le bandeau « À configurer » disparaît et la traduction réelle fonctionne sur tous tes appareils.

## Notes

- L’importeur cherche jusqu’à 200 images dans une page de chapitre publique. Certains sites protégés peuvent refuser l’accès automatique ; ScanMood l’indique alors clairement et ne contourne pas leur protection.
- Les images sont réduites à 2 200 px avant traduction pour économiser le quota gratuit.
- Le code `071079` est un verrouillage visuel local, pas une protection de compte.
- Vérifie les droits de traduction et de diffusion des scans utilisés.

## Structure

```text
dist/                     application GitHub Pages
worker/                   moteur Cloudflare Workers AI
.github/workflows/        publication automatique GitHub Pages
ÉTAPES_CLOUDFLARE.md      guide gratuit pas à pas
```
