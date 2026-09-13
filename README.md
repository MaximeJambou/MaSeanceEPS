# MaSéanceEPS

Site de partage de séances de sport : cycles, séances, exercices et matériel.
Site statique construit avec [Astro](https://astro.build), hébergé gratuitement sur GitHub Pages.

Adresse publique une fois en ligne : **https://yoanndelaloy.github.io/MaSeanceEPS/**

---

## 1. Mise en ligne, une seule fois

1. Créer sur GitHub un dépôt **public** nommé `MaSeanceEPS`.
2. Y envoyer le contenu de ce dossier (glisser-déposer sur GitHub fonctionne très bien
   pour la première fois — mais **pas** le dossier `node_modules`).
3. Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
4. Attendre une à deux minutes : le site est en ligne.

Si le dépôt porte un autre nom, changer `base` dans `astro.config.mjs` en conséquence.

## 2. La clé qui permet de publier depuis le site

L'interface d'administration écrit directement dans le dépôt. Pour cela elle a besoin
d'une clé personnelle, à créer une seule fois :

1. Sur GitHub : **votre photo → Settings → Developer settings → Personal access tokens
   → Fine-grained tokens → Generate new token**.
2. **Repository access** : *Only select repositories* → `MaSeanceEPS`.
3. **Permissions → Repository permissions → Contents** : *Read and write*.
4. Durée : 12 mois (à renouveler ensuite).
5. Copier la clé, ouvrir le site, entrer dans l'administration, onglet **Réglages**,
   la coller et l'enregistrer.

La clé reste dans le navigateur de l'ordinateur utilisé. Elle n'est jamais publiée.

## 3. Entrer dans l'administration

En bas de page, à droite, une **petite bouée** sans libellé. Un clic dessus fait
coulisser un panneau : saisir le code d'accès puis « Se connecter ».

**Code de départ : `Bouee-2026`** — à changer dès la première connexion,
dans l'onglet **Réglages → Changer le code d'accès**.

Le code n'est pas stocké sur le site : seule son empreinte l'est. En revanche,
il ne protège que l'affichage : rien ne peut être publié sans la clé du dépôt.

## 4. Utiliser l'administration

- **Cycles** — créer un cycle (activité, niveaux, période, objectif).
- **Séances** — rattacher une séance à un cycle, décrire l'échauffement,
  les exercices, le retour au calme et le matériel.
- **Ressources** — déposer un PDF (10 Mo maximum) ou rédiger un article.
- **Réglages** — clé du dépôt, code d'accès, textes de la page d'accueil.

Chaque enregistrement envoie une modification au dépôt ; le site se reconstruit
tout seul et la nouveauté apparaît une à deux minutes plus tard.

## 5. Travailler sur le site en local

```bash
npm install      # une seule fois
npm run dev      # aperçu sur http://localhost:4321/MaSeanceEPS/
npm run build    # construit le site dans dist/
```

## 6. Où se trouve quoi

```
public/data/config.json      textes du site, dépôt, empreinte du code d'accès
public/data/cycles.json      les cycles
public/data/seances.json     les séances, leurs exercices et leur matériel
public/data/ressources.json  les documents et articles
public/documents/            les PDF déposés depuis l'administration
public/admin/app.js          le code de l'interface d'administration
src/styles/global.css        toutes les couleurs et tous les espacements
src/pages/                   les pages du site
```

## 7. Règle à ne pas oublier

Le dépôt est public : tout ce qui y est déposé est lisible par n'importe qui,
y compris les PDF. **Aucun nom d'élève, aucune photo d'enfant, aucun résultat
individuel** ne doit être publié ici.
