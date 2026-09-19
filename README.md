# ScanMood 1.2

Application web installable sur iPhone pour traduire des scans anglais, japonais ou chinois vers le français, en conservant le ton de la scène. La traduction remplace le texte original dans les bulles et peut être corrigée avant téléchargement.

## Ce qui est prêt

- écran de verrouillage type iPhone, code `071079` ;
- import JPG, PNG, WEBP et PDF (jusqu’à 12 pages) ;
- import par lien public direct ;
- détection automatique anglais / japonais / chinois ;
- styles Fidèle, Naturel et Adaptation française ;
- remplacement intelligent : nettoyage des bulles ou flou local sur décor ;
- vues Original, Traduit et Comparer ;
- correction manuelle des dialogues ;
- export JPG ou PDF ;
- installation en PWA et fonctionnement GitHub Pages ;
- page démo utilisable sans service IA.

La version 1.2 ajoute un vrai mode sombre, un lecteur plein écran inspiré des sites de scans, un zoom de 50 à 200 %, et transforme la roue dentée en vrais réglages. Elle conserve les corrections iPhone du calque traduit et du comparateur.

## 1. Mettre le site sur GitHub Pages

1. Crée un dépôt GitHub vide.
2. Ajoute tous les fichiers de ce dossier puis pousse-les sur la branche `main`.
3. Dans **Settings → Pages**, sélectionne **GitHub Actions** comme source.
4. Le workflow présent dans `.github/workflows/pages.yml` publie automatiquement le dossier `dist`.

Le site s’ouvre déjà et la page démo fonctionne. Pour traduire de vrais scans, installe le service ci-dessous : une clé IA ne doit jamais être copiée dans un site public GitHub Pages.

## 2. Mettre en ligne le service sécurisé

Le dossier `worker` contient un Cloudflare Worker très léger.

1. Copie `worker/wrangler.toml.example` vers `worker/wrangler.toml`.
2. Remplace `ALLOWED_ORIGINS` par l’adresse exacte de ton GitHub Pages.
3. Depuis le dossier `worker`, lance `npx wrangler deploy`.
4. Ajoute ensuite la clé côté Worker avec `npx wrangler secret put OPENAI_API_KEY`.
5. Dans ScanMood, ouvre l’icône Réglages et colle l’adresse HTTPS du Worker.

Tu peux aussi inscrire cette adresse dans `dist/config.js` pour qu’elle soit déjà configurée sur tous tes appareils.

## Notes importantes

- Le code `071079` est un écran de verrouillage visuel côté navigateur, pas une authentification forte.
- Les images sont réduites à 2 200 px maximum avant traduction afin de limiter le temps et le coût.
- Les liens sont limités aux images/PDF publics en HTTPS, 15 Mo maximum.
- La qualité du remplacement dépend de la précision des zones détectées. Les traductions peuvent être corrigées dans l’app puis réappliquées.
- Vérifie les droits de traduction et de diffusion des scans utilisés.

## Structure

```text
dist/                     site GitHub Pages
worker/                   service sécurisé de traduction
.github/workflows/        déploiement automatique GitHub Pages
```
