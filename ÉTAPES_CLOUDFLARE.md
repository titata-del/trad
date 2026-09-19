# Relier gratuitement ScanMood à Cloudflare

Tout ce guide utilise l’offre gratuite. Il n’y a pas de clé OpenAI à créer.

## Avant de commencer

Il faut :

- ton compte GitHub contenant ScanMood ;
- un compte Cloudflare gratuit ;
- Node.js installé sur l’ordinateur.

## 1. Préparer l’adresse GitHub Pages

Ton site aura une adresse ressemblant à :

```text
https://TON-PSEUDO.github.io/NOM-DU-DEPOT/
```

Dans `worker/wrangler.toml`, remplace :

```text
https://votre-nom.github.io
```

par l’origine de ton site, sans le chemin du dépôt. Exemple :

```text
https://antonin.github.io
```

## 2. Déployer le moteur gratuit

Ouvre un terminal dans le dossier `worker`, puis lance :

```bash
npm install
npx wrangler login
npm run deploy
```

Le navigateur ouvrira Cloudflare pour te connecter et autoriser le déploiement. À la fin, copie l’adresse affichée, par exemple :

```text
https://scanmood-api.ton-sous-domaine.workers.dev
```

## 3. Relier GitHub à cette adresse

Dans GitHub, ouvre `dist/config.js`, clique sur le crayon et remplace la ligne vide par ton adresse :

```js
apiBase: "https://scanmood-api.ton-sous-domaine.workers.dev"
```

Enregistre la modification. GitHub Pages se remettra à jour automatiquement en une à deux minutes.

## 4. Vérifier

Ouvre dans ton navigateur :

```text
https://scanmood-api.ton-sous-domaine.workers.dev/health
```

Tu dois voir `"ok":true`. Recharge ensuite ScanMood : le haut de l’application doit afficher « Moteur gratuit actif ».

## Si la limite gratuite est atteinte

L’application ne facture rien et indique simplement de réessayer le lendemain.
