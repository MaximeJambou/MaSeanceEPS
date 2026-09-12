// Lecture des fichiers de données au moment de la construction du site.
// Ces fichiers sont écrits par l'interface d'administration.
import fs from 'node:fs';

const dossier = new URL('../../public/data/', import.meta.url);

function lire(nom) {
  return JSON.parse(fs.readFileSync(new URL(nom, dossier), 'utf-8'));
}

export const config = lire('config.json');
export const cycles = lire('cycles.json');
export const seances = lire('seances.json');
export const ressources = lire('ressources.json');

export function seancesDuCycle(idCycle) {
  return seances
    .filter((s) => s.cycle === idCycle)
    .sort((a, b) => (a.numero || 0) - (b.numero || 0));
}

export function cycleDe(seance) {
  return cycles.find((c) => c.id === seance.cycle) || null;
}

export function tousLesExercices() {
  const liste = [];
  for (const s of seances) {
    for (const [i, ex] of (s.exercices || []).entries()) {
      liste.push({ ...ex, cle: s.id + '-' + i, seance: s });
    }
  }
  return liste;
}
