// Lecture des fichiers de données au moment de la construction du site.
// Ces fichiers sont écrits par l'interface d'administration.
import fs from 'node:fs';

const dossier = new URL('../../public/data/', import.meta.url);
const lire = (nom) => JSON.parse(fs.readFileSync(new URL(nom, dossier), 'utf-8'));

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

/* Les blocs du déroulé, dans l'ordre, avec leur genre et leur horaire cumulé. */
export function blocsDe(seance) {
  const blocs = [];
  let horloge = 0;
  const pousser = (genre, titre, duree, source) => {
    const d = Number(duree) || 0;
    blocs.push({ genre, titre, duree: d, debut: horloge, fin: horloge + d, source });
    horloge += d;
  };
  if (seance.echauffement) {
    pousser('ech', seance.echauffement.titre || 'Échauffement', seance.echauffement.duree, seance.echauffement);
  }
  (seance.exercices || []).forEach((ex) => pousser('ex', ex.titre, ex.duree, ex));
  if (seance.retour) {
    pousser('ret', seance.retour.titre || 'Retour au calme', seance.retour.duree, seance.retour);
  }
  return blocs;
}

/* Durée réellement occupée par le déroulé, qui peut différer de la durée annoncée. */
export function dureeReelle(seance) {
  return blocsDe(seance).reduce((s, b) => s + b.duree, 0) || Number(seance.duree) || 0;
}

export function horaire(minutes) {
  return String(minutes) + '′';
}

export function tousLesExercices() {
  const liste = [];
  for (const s of seances) {
    const c = cycleDe(s);
    for (const [i, ex] of (s.exercices || []).entries()) {
      liste.push({ ...ex, cle: s.id + '-' + i, rang: i + 1, seance: s, cycle: c });
    }
  }
  return liste;
}

/* Tout le matériel d'un cycle, dédoublonné, pour préparer le local en une fois. */
export function materielDuCycle(idCycle) {
  const vu = new Map();
  for (const s of seancesDuCycle(idCycle)) {
    for (const m of s.materiel || []) {
      const cle = m.toLowerCase().trim();
      if (!vu.has(cle)) vu.set(cle, m);
    }
  }
  return [...vu.values()];
}

export const chiffres = () => ({
  cycles: cycles.length,
  seances: seances.length,
  exercices: tousLesExercices().length,
  moyenne: Math.round(seances.reduce((s, x) => s + dureeReelle(x), 0) / (seances.length || 1)),
});
