# ScanMood — Étape 1 : nettoyage

Cette version est volontairement un prototype qualité. Elle retire les anciennes écritures des scans avant d’ajouter la traduction française.

## Ce que teste cette version

- trois pages maximum par essai ;
- détection des dialogues, pensées, narrations et onomatopées ;
- nettoyage pixel par pixel des bulles claires ou sombres : seuls les pixels des lettres sont remplacés, sans rectangle visible ;
- reconstruction par inpainting pour le texte posé sur un dessin ou une texture ;
- tout texte situé hors d’une bulle ou d’un encadré est reconstruit sur un recadrage rapproché contenant le dessin voisin, jamais couvert par un carré blanc ;
- si le modèle d’inpainting distant ne répond pas, une reconstruction locale directionnelle prolonge les couleurs, dégradés et traits depuis les quatre bords au lieu de laisser le texte intact ;
- protection des contours de bulles et des cases grâce à des zones serrées ;
- un seul affichage final, sans options Original ou Comparer ;
- export du résultat nettoyé en JPG ou PDF ;
- lecture verticale et historique local conservés.
- triple sécurité de détection : lecture visuelle, seconde lecture ciblée, puis OCR local gratuit dans le navigateur si aucune zone n’a été renvoyée ;
- une page avec zéro zone détectée est maintenant signalée en erreur au lieu d’être affichée comme si elle avait été nettoyée.
- le cache mobile ne dépend plus de fichiers absents : la nouvelle version peut enfin remplacer correctement l’ancienne sur iPhone.
- l’OCR local complète désormais systématiquement la détection Cloudflare et analyse les pages longues en deux parties qui se chevauchent, afin de récupérer les petits textes oubliés dans les bulles ;
- hors bulles, l’inpainting est recollé uniquement à travers un masque des lettres et de leur contour : aucun rectangle généré ne peut plus remplacer tout l’arrière-plan.

La traduction et la remise en page typographique seront ajoutées seulement après validation du nettoyage sur plusieurs scans représentatifs.

## Mise à jour

Les fichiers du ZIP remplacent ceux déjà présents à la racine du dépôt GitHub `trad`. Cloudflare redéploie ensuite automatiquement le Worker.

La configuration fournie utilise déjà :

```text
https://scanmood-api.titata0711.workers.dev
```

Après les deux déploiements verts, ouvrir l’application avec `?v=10` pour éviter l’ancien cache.

## Fonctionnement

```text
Scan → détection précise des écritures → nettoyage des fonds → résultat sans texte
```

Les bulles simples sont traitées dans le navigateur. Les zones complexes utilisent le modèle d’inpainting gratuit de Cloudflare Workers AI. Le code de verrouillage reste `071079`.

## Limites de cette étape

- L’import automatique d’un site protégé peut encore être incomplet : ce problème sera repris séparément après la validation du rendu.
- Le modèle d’inpainting est en bêta ; il faut donc contrôler qu’il ne modifie pas un visage ou un trait proche d’une écriture.
- Utiliser uniquement des scans que tu as le droit de transformer et de diffuser.
