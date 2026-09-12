// Construit les liens en tenant compte du sous-dossier GitHub Pages (/MaSeanceEPS/).
const racine = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : import.meta.env.BASE_URL + '/';

export function lien(chemin = '') {
  return racine + String(chemin).replace(/^\//, '');
}
export const RACINE = racine;
