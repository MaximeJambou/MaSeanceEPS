/* ==================================================================
   Schémas de terrain — source unique.
   Ce fichier est utilisé à deux endroits :
     · à la construction du site, importé par SchemaTerrain.astro ;
     · dans le navigateur, par l'interface d'administration.
   Il ne dépend d'aucun DOM : il fabrique des chaînes de caractères.
   ================================================================== */

const TON = { azur: '#0A6FD0', or: '#F2B300', encre: '#0B1A24', blanc: '#FFFFFF', pale: '#7B8E9C' };
const ton = (t) => TON[t] || TON.azur;
const ech = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (n) => Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => i);
const rep = (a, b, n, i) => (n <= 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));

/* ============================ MODÈLES ============================
   Chaque modèle pose quelques questions concrètes à l'utilisateur
   et fabrique lui-même la liste des éléments à dessiner.
   ================================================================= */

export const MODELES = [
  {
    id: 'couloirs',
    nom: 'Couloirs de course',
    quand: 'Départs, sprints, courses en ligne droite d’un point à un autre.',
    champs: [
      { cle: 'nb', label: 'Combien de couloirs ?', type: 'curseur', min: 1, max: 6, defaut: 4 },
      { cle: 'distance', label: 'Distance à parcourir', type: 'curseur', min: 5, max: 60, pas: 5, unite: 'm', defaut: 15 },
      { cle: 'depart', label: 'Position de départ', type: 'choix', defaut: 'debout',
        options: [['debout', 'Debout'], ['accroupi', 'Accroupi'], ['assis', 'Assis, dos à la ligne'], ['mixte', 'Au choix de l’élève']] },
      { cle: 'arrivee', label: 'Ce qui matérialise l’arrivée', type: 'choix', defaut: 'plots',
        options: [['plots', 'Des plots'], ['cerceaux', 'Des cerceaux'], ['zone', 'Une zone tracée']] },
      { cle: 'observateurs', label: 'Un observateur à l’arrivée', type: 'oui-non', defaut: false },
    ],
    construire(p) {
      const n = p.nb, els = [];
      const lettre = { debout: 'D', accroupi: 'A', assis: 'S', mixte: '?' }[p.depart] || 'D';
      els.push({ type: 'zone', x: 6, y: 6, l: 8, h: 50, texte: 'Départ', ton: 'or' });
      if (p.arrivee === 'zone') els.push({ type: 'zone', x: 78, y: 6, l: 16, h: 50, texte: 'Arrivée', ton: 'azur' });
      arr(n).forEach((i) => {
        const y = rep(13, 53, n, i);
        els.push({ type: 'joueur', x: 10, y, ton: p.depart === 'assis' ? 'or' : 'azur', texte: lettre });
        els.push({ type: 'fleche', de: [16, y], a: [76, y], allure: 'course', texte: i === 0 ? p.distance + ' m' : '' });
        if (p.arrivee === 'plots') els.push({ type: 'plot', x: 80, y, n: '' });
        if (p.arrivee === 'cerceaux') els.push({ type: 'joueur', x: 80, y, ton: 'blanc', texte: '' });
        if (p.observateurs) els.push({ type: 'joueur', x: 90, y, ton: 'or', texte: 'O' });
      });
      return els;
    },
    legende: (p) => `${p.nb} couloir${p.nb > 1 ? 's' : ''} de ${p.distance} m, départ ${
      { debout: 'debout', accroupi: 'accroupi', assis: 'assis dos à la ligne', mixte: 'au choix' }[p.depart]
    }${p.observateurs ? ', un observateur à l’arrivée' : ''}.`,
    terrain: 'libre',
  },

  {
    id: 'boucle',
    nom: 'Circuit fermé avec plots numérotés',
    quand: 'Course de durée, course d’endurance, repérage d’allure sur une boucle.',
    champs: [
      { cle: 'plots', label: 'Combien de plots repères ?', type: 'curseur', min: 4, max: 12, defaut: 8 },
      { cle: 'distance', label: 'Longueur du circuit', type: 'curseur', min: 50, max: 400, pas: 25, unite: 'm', defaut: 200 },
      { cle: 'coureurs', label: 'Coureurs en piste', type: 'curseur', min: 1, max: 8, defaut: 3 },
      { cle: 'observateurs', label: 'Observateurs au centre', type: 'curseur', min: 0, max: 8, defaut: 3 },
    ],
    construire(p) {
      const els = [];
      arr(p.plots).forEach((i) => {
        const a = (2 * Math.PI * i) / p.plots;
        els.push({ type: 'plot', x: +(50 + 42 * Math.cos(a)).toFixed(1), y: +(31 + 23 * Math.sin(a)).toFixed(1), n: String(i + 1) });
      });
      arr(p.coureurs).forEach((i) => {
        const a = -Math.PI / 2 + 0.28 + i * 0.3;
        els.push({ type: 'joueur', x: +(50 + 40 * Math.cos(a)).toFixed(1), y: +(31 + 21 * Math.sin(a)).toFixed(1), ton: 'azur', texte: String(i + 1) });
      });
      arr(p.observateurs).forEach((i) => {
        els.push({ type: 'joueur', x: +rep(36, 64, p.observateurs, i).toFixed(1), y: 30, ton: 'or', texte: 'O' });
      });
      els.push({ type: 'fleche', de: [22, 13], a: [40, 9], allure: 'course', texte: 'sens de course' });
      if (p.observateurs) els.push({ type: 'texte', x: 50, y: 38, texte: 'observateurs', ancre: 'middle' });
      return els;
    },
    legende: (p) => `Circuit de ${p.distance} m jalonné de ${p.plots} plots numérotés${
      p.observateurs ? `. ${p.coureurs > 1 ? 'Une vague court' : 'Un élève court'}, les autres observent depuis le centre` : ''}.`,
    terrain: 'piste',
  },

  {
    id: 'relais',
    nom: 'Relais en couloirs',
    quand: 'Relais, navettes, aller-retour par équipes.',
    champs: [
      { cle: 'equipes', label: 'Combien d’équipes ?', type: 'curseur', min: 2, max: 6, defaut: 4 },
      { cle: 'distance', label: 'Longueur d’un couloir', type: 'curseur', min: 5, max: 50, pas: 5, unite: 'm', defaut: 20 },
      { cle: 'retour', label: 'Aller-retour', type: 'oui-non', defaut: true },
    ],
    construire(p) {
      const n = p.equipes, els = [{ type: 'zone', x: 5, y: 4, l: 9, h: 54, texte: 'Relais', ton: 'or' }];
      arr(n).forEach((i) => {
        const y = rep(11, 53, n, i);
        els.push({ type: 'joueur', x: 9, y, ton: 'azur', texte: String(i + 1) });
        els.push({ type: 'plot', x: 16, y, n: '' });
        els.push({ type: 'plot', x: 88, y, n: '' });
        if (p.retour && i === 0) els.push({ type: 'courbe', points: `20,${y - 2} 84,${y - 2} 84,${y + 2} 20,${y + 2}`, allure: 'course' });
        else els.push({ type: 'fleche', de: [20, y], a: [84, y], allure: 'course', texte: i === 1 ? p.distance + ' m' : '' });
      });
      els.push({ type: 'texte', x: 52, y: 63, texte: p.retour ? 'aller-retour, puis on touche le suivant' : 'on touche le suivant à l’arrivée', ancre: 'middle' });
      return els;
    },
    legende: (p) => `${p.equipes} couloirs de ${p.distance} m délimités par des plots. ${p.retour ? 'Aller-retour' : 'Aller simple'}, on touche le suivant pour le lancer.`,
    terrain: 'libre',
  },

  {
    id: 'zones',
    nom: 'Zones de distance',
    quand: 'Lancers, tirs, sauts : on vise une zone de plus en plus lointaine.',
    champs: [
      { cle: 'zones', label: 'Combien de zones ?', type: 'curseur', min: 2, max: 4, defaut: 3 },
      { cle: 'pas', label: 'Écart entre deux zones', type: 'curseur', min: 2, max: 15, unite: 'm', defaut: 5 },
      { cle: 'lanceurs', label: 'Lanceurs en même temps', type: 'curseur', min: 1, max: 5, defaut: 3 },
      { cle: 'attente', label: 'Une zone d’attente derrière', type: 'oui-non', defaut: true },
    ],
    construire(p) {
      const els = [];
      const x0 = p.attente ? 14 : 4;
      if (p.attente) els.push({ type: 'zone', x: 3, y: 4, l: 9, h: 54, texte: 'Attente', ton: 'or' });
      els.push({ type: 'zone', x: x0, y: 4, l: 7, h: 54, texte: 'Lancer', ton: 'azur' });
      const debut = x0 + 16, large = (92 - debut) / p.zones;
      arr(p.zones).forEach((i) => {
        els.push({ type: 'zone', x: +(debut + i * large).toFixed(1), y: 7, l: +(large - 2).toFixed(1), h: 48, texte: (p.pas * (i + 1)) + ' m', ton: 'azur' });
      });
      arr(p.lanceurs).forEach((i) => {
        const y = rep(16, 46, p.lanceurs, i);
        els.push({ type: 'joueur', x: x0 + 3, y, ton: 'azur', texte: 'L' });
        if (i < 2) els.push({ type: 'courbe', points: `${x0 + 8},${y} ${debut + large},${y - 8} ${debut + large * (i + 1.2)},${y + 1}`, allure: 'passe' });
      });
      els.push({ type: 'texte', x: 52, y: 64, texte: 'ramassage au signal uniquement', ancre: 'middle' });
      return els;
    },
    legende: (p) => `${p.zones} zones échelonnées tous les ${p.pas} m. On lance depuis la ligne, on ramasse tous ensemble au signal.`,
    terrain: 'libre',
  },

  {
    id: 'terrain',
    nom: 'Terrain de jeu : attaque contre défense',
    quand: 'Jeux collectifs, situations de passes, conservation, marque.',
    champs: [
      { cle: 'surface', label: 'Surface de jeu', type: 'choix', defaut: 'rectangle',
        options: [['rectangle', 'Terrain entier'], ['demi', 'Demi-terrain']] },
      { cle: 'attaquants', label: 'Attaquants', type: 'curseur', min: 1, max: 7, defaut: 4 },
      { cle: 'defenseurs', label: 'Défenseurs', type: 'curseur', min: 0, max: 7, defaut: 3 },
      { cle: 'cible', label: 'Ce qu’on vise', type: 'choix', defaut: 'but',
        options: [['but', 'Un but'], ['capitaine', 'Un capitaine dans sa zone'], ['zone', 'Une zone d’en-but'], ['aucune', 'Rien : on conserve le ballon']] },
      { cle: 'neutre', label: 'Un joueur neutre (joue avec celui qui a le ballon)', type: 'oui-non', defaut: false },
      { cle: 'arbitre', label: 'Un élève arbitre', type: 'oui-non', defaut: false },
    ],
    construire(p) {
      const els = [];
      if (p.cible === 'capitaine') {
        els.push({ type: 'zone', x: 85, y: 16, l: 12, h: 30, texte: 'Capitaine', ton: 'or' });
        els.push({ type: 'joueur', x: 91, y: 31, ton: 'or', texte: 'C' });
      }
      if (p.cible === 'zone') els.push({ type: 'zone', x: 84, y: 10, l: 13, h: 42, texte: 'En-but', ton: 'or' });
      if (p.cible === 'but') els.push({ type: 'cible', x: 95, y: 31, texte: 'But' });

      const na = p.attaquants, nd = p.defenseurs;
      arr(na).forEach((i) => {
        const x = rep(20, 70, na, i), y = i % 2 ? 42 : 19;
        els.push({ type: 'joueur', x, y, ton: 'azur', texte: 'A' });
      });
      arr(nd).forEach((i) => {
        const x = rep(30, 76, nd, i), y = i % 2 ? 36 : 26;
        els.push({ type: 'joueur', x, y, ton: 'blanc', texte: 'D' });
      });
      if (p.neutre) {
        els.push({ type: 'joueur', x: 48, y: 8, ton: 'or', texte: 'J' });
        els.push({ type: 'texte', x: 48, y: 4, texte: 'J : joueur neutre', ancre: 'middle' });
      }
      if (p.arbitre) {
        els.push({ type: 'joueur', x: 50, y: 63, ton: 'blanc', texte: 'Ar' });
        els.push({ type: 'texte', x: 50, y: 68, texte: 'Ar : arbitre élève', ancre: 'middle' });
      }
      if (na >= 1) {
        const x1 = rep(20, 70, na, 0), y1 = 19;
        els.push({ type: 'ballon', x: x1 + 2, y: y1 + 3 });
        if (na >= 2) {
          const x2 = rep(20, 70, na, 1);
          els.push({ type: 'fleche', de: [x1 + 4, y1 + 2], a: [x2 - 3, 41], allure: 'passe' });
        }
        if (na >= 3) {
          const x2 = rep(20, 70, na, 1), x3 = rep(20, 70, na, 2);
          els.push({ type: 'fleche', de: [x2 + 4, 40], a: [x3 - 3, 21], allure: 'passe' });
        }
      }
      return els;
    },
    legende: (p) => `${p.attaquants} contre ${p.defenseurs}${p.neutre ? ' plus un joueur neutre' : ''} sur ${
      p.surface === 'demi' ? 'un demi-terrain' : 'le terrain entier'}${
      { but: ', on marque dans le but', capitaine: ', on donne au capitaine dans sa zone', zone: ', on marque en atteignant l’en-but', aucune: ', on conserve le ballon' }[p.cible]}.`,
    terrain: (p) => (p.surface === 'demi' ? 'demi' : 'rectangle'),
  },

  {
    id: 'couloirs-largeur',
    nom: 'Terrain découpé en couloirs',
    quand: 'Occuper l’espace : le ballon doit passer par chaque couloir.',
    champs: [
      { cle: 'couloirs', label: 'Combien de couloirs ?', type: 'curseur', min: 2, max: 4, defaut: 3 },
      { cle: 'attaquants', label: 'Attaquants', type: 'curseur', min: 2, max: 7, defaut: 4 },
      { cle: 'defenseurs', label: 'Défenseurs', type: 'curseur', min: 0, max: 7, defaut: 2 },
      { cle: 'cible', label: 'Un but à atteindre', type: 'oui-non', defaut: true },
    ],
    construire(p) {
      const els = [], n = p.couloirs, h = (56 - (n - 1) * 1) / n;
      arr(n).forEach((i) => {
        els.push({ type: 'zone', x: 3, y: +(3 + i * (h + 1)).toFixed(1), l: 94, h: +h.toFixed(1), texte: 'Couloir ' + (i + 1), ton: 'azur' });
      });
      arr(p.attaquants).forEach((i) => {
        els.push({ type: 'joueur', x: +rep(18, 80, p.attaquants, i).toFixed(1), y: +(3 + (i % n) * (h + 1) + h / 2).toFixed(1), ton: 'azur', texte: 'A' });
      });
      arr(p.defenseurs).forEach((i) => {
        els.push({ type: 'joueur', x: +rep(30, 68, p.defenseurs, i).toFixed(1), y: +(3 + ((i + 1) % n) * (h + 1) + h / 2).toFixed(1), ton: 'blanc', texte: 'D' });
      });
      if (p.attaquants >= 2) {
        const y1 = 3 + h / 2, y2 = 3 + (h + 1) + h / 2;
        els.push({ type: 'ballon', x: 20, y: y1 + 2 });
        els.push({ type: 'fleche', de: [22, y1 + 1], a: [rep(18, 80, p.attaquants, 1) - 3, y2], allure: 'passe' });
      }
      if (p.cible) els.push({ type: 'cible', x: 95, y: 31, texte: 'But' });
      return els;
    },
    legende: (p) => `${p.couloirs} couloirs dans la largeur. Le ballon doit passer par chacun avant de pouvoir marquer.`,
    terrain: 'rectangle',
  },

  {
    id: 'binomes',
    nom: 'Binômes face à face',
    quand: 'Un fait, l’autre observe ou compte. Passes, comptage, entraide.',
    champs: [
      { cle: 'binomes', label: 'Combien de binômes ?', type: 'curseur', min: 2, max: 6, defaut: 4 },
      { cle: 'roleA', label: 'Lettre du premier rôle', type: 'texte', defaut: 'A', court: true },
      { cle: 'roleB', label: 'Lettre du second rôle', type: 'texte', defaut: 'O', court: true },
      { cle: 'note', label: 'Légende des rôles', type: 'texte', defaut: 'A : agit · O : observe' },
      { cle: 'lieu', label: 'Où', type: 'choix', defaut: 'libre', options: [['libre', 'Salle ou cour'], ['bassin', 'Dans l’eau']] },
    ],
    construire(p) {
      const els = [], n = p.binomes;
      const yA = p.lieu === 'bassin' ? 48 : 42, yB = p.lieu === 'bassin' ? 36 : 22;
      arr(n).forEach((i) => {
        const x = +rep(16, 84, n, i).toFixed(1);
        els.push({ type: 'joueur', x, y: yA, ton: 'azur', texte: p.roleA || 'A' });
        els.push({ type: 'joueur', x, y: yB, ton: 'or', texte: p.roleB || 'O' });
        els.push({ type: 'fleche', de: [x, yA - 3], a: [x, yB + 3], allure: 'regard' });
      });
      if (p.note) els.push({ type: 'texte', x: 50, y: 64, texte: p.note, ancre: 'middle' });
      return els;
    },
    legende: (p) => `${p.binomes} binômes face à face. ${p.note || ''}`.trim(),
    terrain: (p) => (p.lieu === 'bassin' ? 'bassin' : 'libre'),
  },

  {
    id: 'bassin-bord',
    nom: 'Bassin : postes le long du bord',
    quand: 'Entrées dans l’eau, immersions, déplacements au mur.',
    champs: [
      { cle: 'postes', label: 'Combien de postes ?', type: 'curseur', min: 2, max: 5, defaut: 3 },
      { cle: 'noms', label: 'Nom de chaque poste (séparés par une virgule)', type: 'texte', defaut: 'échelle, assis, debout' },
      { cle: 'encadrant', label: 'Un encadrant dans l’eau', type: 'oui-non', defaut: true },
      { cle: 'sens', label: 'Ce que font les élèves', type: 'choix', defaut: 'entrer',
        options: [['entrer', 'Ils entrent dans l’eau'], ['longer', 'Ils longent le bord']] },
    ],
    construire(p) {
      const els = [], noms = String(p.noms || '').split(',').map((x) => x.trim()).filter(Boolean);
      const n = p.postes;
      arr(n).forEach((i) => {
        const x = +rep(14, 78, n, i).toFixed(1);
        if (p.sens === 'entrer') {
          els.push({ type: 'joueur', x, y: 52, ton: 'azur', texte: String(i + 1) });
          els.push({ type: 'fleche', de: [x, 50], a: [x, 38], allure: 'course' });
        } else {
          els.push({ type: 'joueur', x, y: 50, ton: 'azur', texte: String(i + 1) });
        }
        if (noms[i]) els.push({ type: 'texte', x, y: 64, texte: noms[i], ancre: 'middle' });
      });
      if (p.sens === 'longer') els.push({ type: 'courbe', points: `14,50 40,50 66,50 88,50`, allure: 'course' });
      if (p.encadrant) {
        els.push({ type: 'joueur', x: 90, y: 40, ton: 'blanc', texte: 'M' });
        els.push({ type: 'texte', x: 88, y: 64, texte: 'encadrant', ancre: 'middle' });
      }
      return els;
    },
    legende: (p) => `${p.postes} postes le long du bord${p.noms ? ' : ' + p.noms : ''}.${p.encadrant ? ' Un encadrant dans l’eau.' : ''}`,
    terrain: 'bassin',
  },

  {
    id: 'bassin-traversee',
    nom: 'Bassin : traversées par niveau',
    quand: 'Se déplacer dans l’eau, avec plus ou moins d’aide selon le couloir.',
    champs: [
      { cle: 'couloirs', label: 'Combien de couloirs ?', type: 'curseur', min: 2, max: 4, defaut: 3 },
      { cle: 'niveaux', label: 'Aide par couloir (séparée par une virgule)', type: 'texte', defaut: 'frite sous les bras, frite à bout de bras, sans rien' },
      { cle: 'distance', label: 'Distance à traverser', type: 'curseur', min: 1, max: 15, unite: 'm', defaut: 3 },
      { cle: 'encadrant', label: 'Un encadrant à mi-parcours', type: 'oui-non', defaut: true },
    ],
    construire(p) {
      const els = [], n = p.couloirs, h = (46 - (n - 1) * 2) / n;
      const noms = String(p.niveaux || '').split(',').map((x) => x.trim());
      arr(n).forEach((i) => {
        const y = +(9 + i * (h + 2)).toFixed(1);
        els.push({ type: 'zone', x: 22, y, l: 56, h: +h.toFixed(1), texte: noms[i] || 'couloir ' + (i + 1), ton: i === n - 1 ? 'or' : 'azur' });
        els.push({ type: 'joueur', x: 26, y: +(y + h / 2).toFixed(1), ton: 'azur', texte: String(i + 1) });
        els.push({ type: 'fleche', de: [31, +(y + h / 2).toFixed(1)], a: [74, +(y + h / 2).toFixed(1)], allure: 'course', texte: i === 0 ? p.distance + ' m' : '' });
      });
      if (p.encadrant) els.push({ type: 'joueur', x: 50, y: +(9 + (n - 1) * (h + 2) + h / 2).toFixed(1), ton: 'blanc', texte: 'M' });
      return els;
    },
    legende: (p) => `${p.couloirs} couloirs de ${p.distance} m, une aide différente par couloir. On change de couloir quand on se sent prêt.`,
    terrain: 'bassin',
  },

  {
    id: 'ateliers',
    nom: 'Ateliers en rotation',
    quand: 'Plusieurs postes en parallèle, les groupes tournent au signal.',
    champs: [
      { cle: 'ateliers', label: 'Combien d’ateliers ?', type: 'curseur', min: 2, max: 6, defaut: 4 },
      { cle: 'parAtelier', label: 'Élèves par atelier', type: 'curseur', min: 1, max: 8, defaut: 4 },
      { cle: 'noms', label: 'Nom des ateliers (séparés par une virgule)', type: 'texte', defaut: '' },
    ],
    construire(p) {
      const els = [], n = p.ateliers, cols = n <= 2 ? 2 : n <= 4 ? 2 : 3;
      const rangs = Math.ceil(n / cols);
      const noms = String(p.noms || '').split(',').map((x) => x.trim());
      arr(n).forEach((i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const l = 88 / cols - 4, h = 52 / rangs - 4;
        const x = +(6 + c * (l + 4)).toFixed(1), y = +(5 + r * (h + 4)).toFixed(1);
        els.push({ type: 'zone', x, y, l: +l.toFixed(1), h: +h.toFixed(1), texte: noms[i] || 'Atelier ' + (i + 1), ton: i % 2 ? 'or' : 'azur' });
        arr(Math.min(p.parAtelier, 4)).forEach((j) => {
          els.push({ type: 'joueur', x: +(x + 6 + j * 7).toFixed(1), y: +(y + h - 5).toFixed(1), ton: 'azur', texte: '' });
        });
      });
      els.push({ type: 'texte', x: 50, y: 64, texte: 'rotation au signal', ancre: 'middle' });
      return els;
    },
    legende: (p) => `${p.ateliers} ateliers en parallèle, ${p.parAtelier} élèves par atelier, rotation au signal.`,
    terrain: 'libre',
  },
];

export const modele = (id) => MODELES.find((m) => m.id === id) || null;

export function valeursParDefaut(id) {
  const m = modele(id);
  if (!m) return {};
  const p = {};
  m.champs.forEach((c) => { p[c.cle] = c.defaut; });
  return p;
}

/* Fabrique le schéma complet à partir d'un modèle et de ses réponses. */
export function genererSchema(id, params) {
  const m = modele(id);
  if (!m) return null;
  const p = { ...valeursParDefaut(id), ...(params || {}) };
  return {
    modele: id,
    params: p,
    terrain: typeof m.terrain === 'function' ? m.terrain(p) : m.terrain,
    legende: m.legende(p),
    elements: m.construire(p),
  };
}

/* ======================= DÉTECTION AUTOMATIQUE =======================
   À partir de ce que l'utilisateur a déjà écrit (titre, description,
   organisation), on devine le modèle le plus probable et on pré-remplit
   les nombres trouvés dans le texte. Il n'a plus qu'à corriger.
   ==================================================================== */

const MOTS_NOMBRE = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12 };

function nombreApres(txt, motif) {
  const re = new RegExp('(\\d{1,3}|' + Object.keys(MOTS_NOMBRE).join('|') + ')\\s*' + motif, 'i');
  const m = txt.match(re);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return MOTS_NOMBRE[v] ?? parseInt(v, 10);
}
function distance(txt) {
  const m = txt.match(/(\d{1,4})\s*(?:m\b|mètres?)/i);
  return m ? parseInt(m[1], 10) : null;
}

const REGLES = [
  { id: 'bassin-traversee', motifs: [/travers/i, /frite/i, /sans appui/i, /couloir/i], eau: true, poids: 3 },
  { id: 'bassin-bord',      motifs: [/bord/i, /goulotte/i, /échelle|echelle/i, /entrée|entree|immers|bassin|eau/i], eau: true, poids: 2 },
  { id: 'boucle',           motifs: [/boucle|circuit|tour|endurance|allure|six minutes|durée de course/i], poids: 3 },
  { id: 'relais',           motifs: [/relais|navette|aller-retour|touche la main|passe le témoin/i], poids: 3 },
  { id: 'zones',            motifs: [/lanc|zone de \d|viser|cible|tir\b/i], poids: 3 },
  { id: 'couloirs-largeur', motifs: [/couloir/i, /largeur|occuper l'espace|trois zones/i], poids: 3 },
  { id: 'terrain',          motifs: [/passe|ballon|attaqu|défen|defen|démarqu|demarqu|capitaine|match|but\b|interception/i], poids: 2 },
  { id: 'couloirs',         motifs: [/départ|depart|sprint|signal|duel|ligne droite|couloir/i], poids: 2 },
  { id: 'binomes',          motifs: [/binôme|binome|par deux|l'autre compte|observateur compte|face à face/i], poids: 2 },
  { id: 'ateliers',         motifs: [/atelier/i, /rotation|tourne au signal/i], poids: 2 },
];

export function detecter(texte) {
  const t = String(texte || '').toLowerCase();
  if (!t.trim()) return null;
  const eau = /eau|bassin|piscine|nager|immers|frite|goulotte|flott/i.test(t);

  let meilleur = null, meilleurScore = 0;
  for (const r of REGLES) {
    if (!r.motifs) continue;
    if (r.eau && !eau) continue;
    if (!r.eau && eau && r.id !== 'binomes') continue;
    let score = 0;
    r.motifs.forEach((m) => { if (m instanceof RegExp && m.test(t)) score += r.poids || 1; });
    if (score > meilleurScore) { meilleurScore = score; meilleur = r.id; }
  }
  if (!meilleur) meilleur = eau ? 'bassin-bord' : 'couloirs';

  const p = valeursParDefaut(meilleur);
  const d = distance(t);
  if (d && 'distance' in p) p.distance = Math.min(Math.max(d, 1), meilleur === 'boucle' ? 400 : 60);

  const couloirs = nombreApres(t, 'couloirs?');
  const equipes = nombreApres(t, '(?:équipes?|equipes?)');
  const plots = nombreApres(t, 'plots?');
  const zones = nombreApres(t, 'zones?');
  const ateliers = nombreApres(t, 'ateliers?');
  if (couloirs) { if ('nb' in p) p.nb = couloirs; if ('couloirs' in p) p.couloirs = couloirs; }
  if (equipes && 'equipes' in p) p.equipes = equipes;
  if (plots && 'plots' in p) p.plots = plots;
  if (zones && 'zones' in p) p.zones = zones;
  if (ateliers && 'ateliers' in p) p.ateliers = ateliers;

  const contre = t.match(/(\d+)\s*(?:contre|c)\s*(\d+)/i);
  if (contre && 'attaquants' in p) { p.attaquants = +contre[1]; p.defenseurs = +contre[2]; }
  if (/capitaine/i.test(t) && 'cible' in p) p.cible = 'capitaine';
  if (/en-but|essai/i.test(t) && 'cible' in p) p.cible = 'zone';
  if (/conserv|dix passes|garder le ballon/i.test(t) && 'cible' in p) p.cible = 'aucune';
  if (/neutre|joueur libre|passeur libre/i.test(t) && 'neutre' in p) p.neutre = true;
  if (/arbitr/i.test(t) && 'arbitre' in p) p.arbitre = true;
  if (/assis/i.test(t) && 'depart' in p) p.depart = 'assis';
  if (/accroupi/i.test(t) && 'depart' in p) p.depart = 'accroupi';
  if (/cerceau/i.test(t) && 'arrivee' in p) p.arrivee = 'cerceaux';
  if (/aller simple|sans retour/i.test(t) && 'retour' in p) p.retour = false;

  return { modele: meilleur, params: p };
}

/* ============================= DESSIN =============================
   Rend le schéma en SVG. Utilisé tel quel par le site et par l'aperçu
   en direct de l'administration : les deux ne peuvent pas diverger.
   ================================================================== */

function fondTerrain(t, id) {
  if (t === 'rectangle') return `<g fill="none" stroke="#C9D6E2" stroke-width=".8">
    <rect x="3" y="3" width="94" height="56" rx="1.5" fill="#F7FAFD"/><line x1="50" y1="3" x2="50" y2="59"/>
    <circle cx="50" cy="31" r="9"/><rect x="3" y="16" width="12" height="30"/><rect x="85" y="16" width="12" height="30"/></g>`;
  if (t === 'demi') return `<g fill="none" stroke="#C9D6E2" stroke-width=".8">
    <rect x="3" y="3" width="94" height="56" rx="1.5" fill="#F7FAFD"/><rect x="82" y="14" width="15" height="34"/>
    <path d="M82 20 a12 11 0 0 0 0 22"/><line x1="20" y1="3" x2="20" y2="59" stroke-dasharray="2 2"/></g>`;
  if (t === 'piste') return `<g fill="none" stroke="#C9D6E2" stroke-width=".8">
    <rect x="2" y="2" width="96" height="58" rx="28" fill="#F7F4EA"/><rect x="9" y="9" width="82" height="44" rx="21"/>
    <rect x="17" y="17" width="66" height="28" rx="14" fill="#EFF6EC" stroke="#D7E4D2"/></g>`;
  if (t === 'bassin') return `<g>
    <rect x="3" y="6" width="94" height="50" rx="1.5" fill="url(#${id}-eau)" stroke="#9FBFDD" stroke-width=".8"/>
    <g stroke="#9FBFDD" stroke-width=".6" stroke-dasharray="3 2"><line x1="3" y1="18.5" x2="97" y2="18.5"/><line x1="3" y1="31" x2="97" y2="31"/><line x1="3" y1="43.5" x2="97" y2="43.5"/></g>
    <rect x="3" y="2" width="94" height="4" fill="#E8E2D2" stroke="#C9C0AA" stroke-width=".5"/>
    <rect x="3" y="56" width="94" height="4" fill="#E8E2D2" stroke="#C9C0AA" stroke-width=".5"/>
    <g stroke="#8A99A6" stroke-width=".9" fill="none"><path d="M8 56 v-5 M12 56 v-5 M8 53.5 h4"/></g></g>`;
  return `<rect x="2" y="2" width="96" height="58" rx="2" fill="#F9F7F1" stroke="#DFD7C4" stroke-width=".8"/>`;
}

const MONO = "font-family:'IBM Plex Mono',ui-monospace,monospace";

function dessinerElement(e, id) {
  switch (e.type) {
    case 'zone': {
      const t = ton(e.ton), dedans = String(e.texte || '').length * 1.55 <= e.l;
      return `<rect x="${e.x}" y="${e.y}" width="${e.l}" height="${e.h}" rx="1.5" fill="${t}" fill-opacity=".09" stroke="${t}" stroke-width=".7" stroke-dasharray="2.4 1.8"/>` +
        (e.texte ? (dedans
          ? `<text x="${e.x + 1.8}" y="${e.y + 4}" font-size="2.6" fill="${t}" style="${MONO};font-weight:600">${ech(e.texte)}</text>`
          : `<text x="${e.x + e.l / 2}" y="${e.y - 1.4}" font-size="2.6" text-anchor="middle" fill="${t}" style="${MONO};font-weight:600">${ech(e.texte)}</text>`) : '');
    }
    case 'courbe':
      return `<polyline points="${ech(e.points)}" fill="none" stroke="${e.allure === 'passe' ? '#7A5A00' : '#0A6FD0'}" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="${e.allure === 'passe' ? '2.4 1.8' : '0'}" marker-end="url(#${id}-${e.allure === 'passe' ? 'o' : 'p'})"/>`;
    case 'fleche': {
      const c = e.allure === 'passe' ? '#7A5A00' : '#0A6FD0';
      const dash = e.allure === 'passe' ? '2.4 1.8' : e.allure === 'regard' ? '1 1.6' : '0';
      return `<line x1="${e.de[0]}" y1="${e.de[1]}" x2="${e.a[0]}" y2="${e.a[1]}" stroke="${c}" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="${dash}" marker-end="url(#${id}-${e.allure === 'passe' ? 'o' : 'p'})"/>` +
        (e.texte ? `<text x="${(e.de[0] + e.a[0]) / 2}" y="${(e.de[1] + e.a[1]) / 2 - 1.6}" font-size="2.7" text-anchor="middle" fill="#4A6072" style="${MONO}">${ech(e.texte)}</text>` : '');
    }
    case 'plot':
      return `<path d="M${e.x} ${e.y - 3.2} L${e.x + 2.8} ${e.y + 1.8} L${e.x - 2.8} ${e.y + 1.8} Z" fill="#F2B300" stroke="#0B1A24" stroke-width=".6" stroke-linejoin="round"/>` +
        (e.n ? `<text x="${e.x}" y="${e.y + 5.6}" font-size="2.7" text-anchor="middle" fill="#0B1A24" style="${MONO};font-weight:600">${ech(e.n)}</text>` : '');
    case 'joueur':
      return `<circle cx="${e.x}" cy="${e.y}" r="2.6" fill="${ton(e.ton)}" stroke="#0B1A24" stroke-width=".6"/>` +
        (e.texte ? `<text x="${e.x}" y="${e.y + 1}" font-size="2.4" text-anchor="middle" fill="${e.ton === 'or' || e.ton === 'blanc' ? '#0B1A24' : '#fff'}" style="${MONO};font-weight:600">${ech(e.texte)}</text>` : '');
    case 'ballon':
      return `<circle cx="${e.x}" cy="${e.y}" r="1.9" fill="#fff" stroke="#0B1A24" stroke-width=".6"/><path d="M${e.x - 1.9} ${e.y} h3.8 M${e.x} ${e.y - 1.9} v3.8" stroke="#0B1A24" stroke-width=".4"/>`;
    case 'cible':
      return `<rect x="${e.x - 1.6}" y="${e.y - 6}" width="3.2" height="12" rx=".8" fill="#fff" stroke="#0B1A24" stroke-width=".7"/><path d="M${e.x - 1.6} ${e.y - 6} v12" stroke="#0A6FD0" stroke-width="1.2"/>` +
        (e.texte ? `<text x="${e.x}" y="${e.y + 9.6}" font-size="2.6" text-anchor="middle" fill="#4A6072" style="${MONO}">${ech(e.texte)}</text>` : '');
    case 'texte':
      return `<text x="${e.x}" y="${e.y}" font-size="3" text-anchor="${e.ancre || 'middle'}" fill="#4A6072" style="${MONO};font-weight:600">${ech(e.texte)}</text>`;
    default: return '';
  }
}

function clesDe(els) {
  const c = [];
  const a = (f, t) => c.push({ f, t });
  if (els.some((e) => e.type === 'plot')) a('plot', 'Plot');
  if (els.some((e) => e.type === 'joueur' && (e.ton || 'azur') === 'azur')) a('rond azur', 'Élève en action');
  if (els.some((e) => e.type === 'joueur' && e.ton === 'or')) a('rond or', 'Observateur ou rôle particulier');
  if (els.some((e) => e.type === 'joueur' && e.ton === 'blanc')) a('rond blanc', 'Défenseur, adulte ou attente');
  if (els.some((e) => e.type === 'ballon')) a('rond blanc', 'Ballon');
  if (els.some((e) => (e.type === 'fleche' || e.type === 'courbe') && (e.allure || 'course') === 'course')) a('trait', 'Déplacement');
  if (els.some((e) => (e.type === 'fleche' || e.type === 'courbe') && e.allure === 'passe')) a('trait', 'Passe ou trajectoire de l’engin');
  if (els.some((e) => e.type === 'zone')) a('azur', 'Zone délimitée');
  return c;
}

/* Rend la figure complète : SVG + clés de lecture + légende. */
export function figureSchema(schema, idUnique) {
  if (!schema || !schema.elements) return '';
  const id = idUnique || 'sch' + Math.random().toString(36).slice(2, 8);
  const els = schema.elements;
  const cles = clesDe(els).map((c) => `<span class="schema__cle"><i class="${c.f}"></i>${ech(c.t)}</span>`).join('');
  return `<figure class="schema">
  <svg class="schema__toile" viewBox="0 0 100 70" role="img" aria-label="${ech(schema.legende || 'Schéma de mise en place')}">
    <defs>
      <marker id="${id}-p" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#0A6FD0"/></marker>
      <marker id="${id}-o" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#7A5A00"/></marker>
      <pattern id="${id}-eau" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#E4F0FC"/><path d="M0 4.5 q1.5 -1.6 3 0 t3 0" fill="none" stroke="#BBD9F2" stroke-width=".7"/></pattern>
    </defs>
    ${fondTerrain(schema.terrain, id)}
    ${els.map((e) => dessinerElement(e, id)).join('')}
  </svg>
  ${cles ? `<div class="schema__cles">${cles}</div>` : ''}
  ${schema.legende ? `<figcaption class="schema__legende"><b>Mise en place</b><span>${ech(schema.legende)}</span></figcaption>` : ''}
</figure>`;
}

if (typeof window !== 'undefined') {
  window.MSE_SCHEMA = { MODELES, modele, valeursParDefaut, genererSchema, detecter, figureSchema };
}
