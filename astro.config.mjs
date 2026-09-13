// @ts-check
import { defineConfig } from 'astro/config';

// Adresse finale du site sur GitHub Pages.
// site  = l'adresse du compte GitHub
// base  = le nom du dépôt (à changer si le dépôt est renommé)
export default defineConfig({
  site: 'https://yoanndelaloy.github.io',
  base: '/MaSeanceEPS',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
