# Règles UI/UX : bibliothèques de composants à utiliser d'abord

## Principe
Avant de coder un composant UI à la main (bouton, modale, formulaire, tableau, animation, loader, upload, etc.),
**toujours chercher d'abord s'il existe déjà dans les bibliothèques gratuites ci-dessous**, puis l'installer ou
l'adapter. Ne pas réinventer ce qui existe.

Penser aussi à chercher proactivement (WebSearch) s'il existe un composant ou un pattern intéressant pour
améliorer l'UX du projet en cours, même si je ne l'ai pas demandé. Proposer en une ligne, sans bloquer le travail.

## Web (Next.js / React + Tailwind)
- **shadcn/ui** : base par défaut (boutons, formulaires, dialogs, tables). Install : `npx shadcn@latest add <composant>`
- **Origin UI** : grosse collection gratuite en plus de shadcn
- **Magic UI** / **Aceternity UI** / **Motion Primitives** : composants animés (landing pages, effets, micro-interactions)
- **Kibo UI** / **ReUI** / **Cult UI** : blocs plus avancés (dashboards, apps)
- **dqnamo.com/kitchen** : expériences de composants (Receipt Printer, Hold to Confirm, Dynamic Button, Magnetic Drop Zone...).
  Source d'inspiration uniquement : aucune licence trouvée, ne pas copier tel quel en production sans accord.

## Mobile (Expo / React Native)
- **HeroUI Native**, **React Native Paper**, **Tamagui**, **Gluestack UI**, **NativeWind UI**
- Choisir selon la stack du projet (NativeWind => HeroUI Native / NativeWind UI).

## Règles
1. Vérifier la licence avant usage dans un produit (la plupart sont MIT, mais certaines ont une partie Pro payante).
2. Suivre la doc d'installation officielle de chaque bibliothèque (elles évoluent).
3. Garder le style cohérent avec le design du projet (couleurs, thème sombre/clair, accessibilité).
4. Si plusieurs options conviennent, en choisir une et expliquer en une phrase pourquoi.
5. Citer d'où vient le composant (nom de la lib) dans le résumé de fin de tâche.

---

# Économie de tokens : Graphify (À FAIRE AU DÉBUT DE CHAQUE CONVERSATION)

Alex travaille depuis son téléphone : **1 conversation = 1 tâche**, finie et mise en prod.
Graphify construit une "carte" du code (fonctions, fichiers, qui appelle qui) en ~1 seconde, **sans aucun token IA**.
But : ne jamais fouiller le code à l'aveugle.

## Démarrage (obligatoire, avant toute lecture de code)
```bash
pip install --break-system-packages -q graphifyy   # si `graphify` absent
graphify update .                                  # reconstruit la carte, 0 token
```
1. Lire `graphify-out/GRAPH_REPORT.md` (court) pour s'orienter.
2. Pour trouver où toucher : `graphify query "<mots-clés de la tâche>"` puis `graphify explain "<fonction>"`.
3. Ensuite seulement, ouvrir les 2-3 fichiers indiqués par la carte.

## Interdits
- Ne JAMAIS lire `graphify-out/graph.json` ni `graph.html` en entier (énormes, ça brûle des tokens).
- Pas de Glob/Grep large sur tout le repo si la carte donne déjà la réponse.
- `graphify-out/` n'est pas versionné (dans .gitignore) : la carte est refaite à chaque conversation, donc toujours à jour.

## Fin de tâche = en prod
- Vérifier (lint / typecheck / test rapide) avant de livrer.
- Commit + push sur `main`.
- Résumé final à Alex : 2-3 lignes max, visuel si utile, en français simple.
- Site : le push sur `main` déclenche le déploiement Vercel en prod automatiquement. Vérifier ensuite que le déploiement est "Ready" (outils Vercel).
