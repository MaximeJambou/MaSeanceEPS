/* ==================================================================
   MaSéanceEPS — interface d'administration
   Tout se passe dans le navigateur : les modifications sont envoyées
   directement au dépôt GitHub via son API, puis le site se reconstruit
   tout seul (1 à 2 minutes).
   ================================================================== */

const BASE = window.MSE_BASE || '/';
const CLE_JETON = 'mse-jeton-github';
const ITERATIONS_COFFRE = 600000;

const etat = {
  config: null,
  cycles: [],
  seances: [],
  ressources: [],
  sha: {},          // empreinte GitHub de chaque fichier (nécessaire pour écrire)
  connecte: false,  // vrai quand un jeton valide est enregistré
  coffre: null,     // clé chiffrée rangée dans le dépôt, si elle existe
};

/* ------------------------------ outils ------------------------------ */

const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => Array.from(racine.querySelectorAll(sel));

function echappe(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function message(texte, genre = '') {
  const boite = document.createElement('div');
  boite.className = 'msg' + (genre ? ' msg--' + genre : '');
  boite.textContent = texte;
  $('#messages').appendChild(boite);
  setTimeout(() => boite.remove(), 5200);
}

function identifiant(texte) {
  return String(texte)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
}

function lignes(texte) {
  return String(texte || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function enBase64(texte) {
  const octets = new TextEncoder().encode(texte);
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  }
  return btoa(binaire);
}

/* ------------------- coffre : clé chiffrée partagée -------------------
   Le site est statique : il ne peut cacher aucun secret. La clé de dépôt
   est donc chiffrée avec une phrase de passe (PBKDF2 600 000 tours puis
   AES-GCM 256) avant d'être rangée dans le dépôt. Sans la phrase, le
   fichier ne vaut rien. La phrase, elle, n'est écrite nulle part.
   -------------------------------------------------------------------- */

function octetsEnBase64(octets) {
  let binaire = '';
  octets.forEach((o) => { binaire += String.fromCharCode(o); });
  return btoa(binaire);
}

function base64EnOctets(texte) {
  return Uint8Array.from(atob(texte), (c) => c.charCodeAt(0));
}

async function deriverCle(phrase, sel, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations: iterations || ITERATIONS_COFFRE, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function fabriquerCoffre(phrase, valeur) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await deriverCle(phrase, sel, ITERATIONS_COFFRE);
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(valeur));
  return {
    version: 1,
    iterations: ITERATIONS_COFFRE,
    sel: octetsEnBase64(sel),
    iv: octetsEnBase64(iv),
    donnee: octetsEnBase64(new Uint8Array(chiffre)),
  };
}

async function ouvrirCoffre(phrase, coffre) {
  const cle = await deriverCle(phrase, base64EnOctets(coffre.sel), coffre.iterations);
  const clair = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64EnOctets(coffre.iv) }, cle, base64EnOctets(coffre.donnee)
  );
  return new TextDecoder().decode(clair);
}

async function chargerCoffre() {
  try {
    const reponse = await fetch(BASE + 'data/cle.json?t=' + Date.now(), { cache: 'no-store' });
    if (!reponse.ok) { etat.coffre = null; return; }
    const contenu = await reponse.json();
    etat.coffre = contenu && contenu.donnee ? contenu : null;
  } catch (_) {
    etat.coffre = null;
  }
}

/* --------------------------- accès GitHub --------------------------- */

function jeton() {
  try { return localStorage.getItem(CLE_JETON) || ''; } catch (_) { return ''; }
}

function urlContenu(chemin) {
  const d = etat.config.depot;
  return `https://api.github.com/repos/${d.proprietaire}/${d.nom}/contents/${chemin}`;
}

async function appelGitHub(url, options = {}) {
  const reponse = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + jeton(),
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!reponse.ok) {
    let detail = reponse.status + ' ' + reponse.statusText;
    try { const j = await reponse.json(); if (j.message) detail = j.message; } catch (_) {}
    throw new Error(detail);
  }
  return reponse.json();
}

async function lireFichier(chemin) {
  const d = etat.config.depot;
  const data = await appelGitHub(urlContenu(chemin) + '?ref=' + encodeURIComponent(d.branche));
  etat.sha[chemin] = data.sha;
  const texte = new TextDecoder().decode(
    Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
  );
  return JSON.parse(texte);
}

async function ecrireFichier(chemin, contenuBase64, description) {
  const d = etat.config.depot;
  // On rafraîchit l'empreinte juste avant d'écrire, au cas où le fichier
  // aurait changé entre-temps.
  try {
    const actuel = await appelGitHub(urlContenu(chemin) + '?ref=' + encodeURIComponent(d.branche));
    etat.sha[chemin] = actuel.sha;
  } catch (_) { delete etat.sha[chemin]; }

  const corps = {
    message: description,
    content: contenuBase64,
    branch: d.branche,
  };
  if (etat.sha[chemin]) corps.sha = etat.sha[chemin];

  const resultat = await appelGitHub(urlContenu(chemin), {
    method: 'PUT',
    body: JSON.stringify(corps),
  });
  etat.sha[chemin] = resultat.content.sha;
  return resultat;
}

async function publier(fichier, donnees, description) {
  if (!etat.connecte) {
    message("Aucune clé de dépôt enregistrée : va dans Réglages pour l'ajouter.", 'erreur');
    return false;
  }
  const badge = $('#etat-publication');
  badge.hidden = false;
  badge.className = 'pastille pastille--attente';
  badge.textContent = 'Publication en cours…';
  try {
    await ecrireFichier('public/data/' + fichier, enBase64(JSON.stringify(donnees, null, 2) + '\n'), description);
    badge.className = 'pastille pastille--ok';
    badge.textContent = 'Publié — en ligne dans 1 à 2 min';
    message('Enregistré. Le site se met à jour dans une à deux minutes.', 'ok');
    setTimeout(() => { badge.hidden = true; }, 12000);
    return true;
  } catch (e) {
    badge.className = 'pastille pastille--erreur';
    badge.textContent = 'Échec de la publication';
    message('Publication impossible : ' + e.message, 'erreur');
    return false;
  }
}

/* ---------------------------- chargement ---------------------------- */

async function chargerLocal() {
  const [cycles, seances, ressources] = await Promise.all([
    fetch(BASE + 'data/cycles.json').then((r) => r.json()),
    fetch(BASE + 'data/seances.json').then((r) => r.json()),
    fetch(BASE + 'data/ressources.json').then((r) => r.json()),
  ]);
  etat.cycles = cycles;
  etat.seances = seances;
  etat.ressources = ressources;
}

async function chargerDepuisGitHub() {
  etat.cycles = await lireFichier('public/data/cycles.json');
  etat.seances = await lireFichier('public/data/seances.json');
  etat.ressources = await lireFichier('public/data/ressources.json');
  etat.config = await lireFichier('public/data/config.json');
}

function afficherEtatDepot(texte, genre) {
  const badge = $('#etat-depot');
  badge.textContent = texte;
  badge.className = 'pastille ' + (genre || '');
}

/* ============================ helpers d'écran ============================ */

const S = window.MSE_SCHEMA;

function curseur({ id, label, val, min, max, pas = 1, unite = 'min', or = false, aide = '' }) {
  return `
    <div class="champ duree${or ? ' duree--or' : ''}">
      <span class="champ__label">${echappe(label)}${aide ? ` <span class="champ__aide">${echappe(aide)}</span>` : ''}</span>
      <div class="duree__haut"><span class="duree__val" data-val="${id}">${val}</span><span class="duree__unite">${echappe(unite)}</span></div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${pas}" value="${val}"
             aria-label="${echappe(label)}" data-curseur>
    </div>`;
}

/* colore la partie parcourue du curseur et met le nombre à jour */
function brancherCurseurs(racine = document) {
  $$('input[data-curseur]', racine).forEach((c) => {
    const peindre = () => {
      const p = ((c.value - c.min) / (c.max - c.min)) * 100;
      c.style.setProperty('--part', p + '%');
      const cible = $(`[data-val="${c.id}"]`, c.closest('.duree') || document);
      if (cible) cible.textContent = c.value;
    };
    c.addEventListener('input', peindre);
    peindre();
  });
}

function champ(id, label, valeur = '', { aide = '', zone = false, type = 'text', ph = '' } = {}) {
  const c = `<span class="champ__label">${echappe(label)}${aide ? ` <span class="champ__aide">${echappe(aide)}</span>` : ''}</span>`;
  return `<div class="champ"><label for="${id}">${c}</label>${
    zone ? `<textarea id="${id}" placeholder="${echappe(ph)}">${echappe(valeur)}</textarea>`
         : `<input id="${id}" type="${type}" placeholder="${echappe(ph)}" value="${echappe(valeur)}">`}</div>`;
}

const val = (id) => (($(`#${id}`) || {}).value || '').trim();
const num = (id) => Number(($(`#${id}`) || {}).value) || 0;

/* ============================ tableau de bord ============================ */

function vueTableau() {
  const d = etat.config.depot;
  const nbEx = etat.seances.reduce((n, s) => n + (s.exercices || []).length, 0);
  const nbSch = etat.seances.reduce((n, s) => n + (s.exercices || []).filter((e) => e.schema).length, 0);
  const sansSchema = etat.seances.flatMap((s) => (s.exercices || []).filter((e) => !e.schema).map((e) => ({ e, s })));

  $('#vue-tableau').innerHTML = `
    <div class="adm-titre"><h1>Tableau de bord</h1></div>

    <div class="chiffres">
      <div class="k"><b>${etat.cycles.length}</b><span>cycles</span></div>
      <div class="k"><b>${etat.seances.length}</b><span>séances</span></div>
      <div class="k"><b>${nbEx}</b><span>exercices</span></div>
      <div class="k"><b>${nbSch}</b><span>schémas</span></div>
    </div>

    <div class="k">
      <h2 class="k__titre">Où en est le contenu</h2>
      <p class="k__note">Une séance sans exercice ou un exercice sans schéma reste utilisable, mais la fiche perd de sa force sur le terrain.</p>
      ${etat.cycles.map((c) => {
        const ss = etat.seances.filter((s) => s.cycle === c.id);
        return `<div class="rang">
          <span class="rang__num">${ss.length}</span>
          <div class="rang__corps"><strong>${echappe(c.titre)}</strong>
            <div class="rang__meta"><span>${echappe(c.sport)}</span><span>${echappe(c.niveaux || '')}</span><span>${ss.reduce((n, s) => n + (s.exercices || []).length, 0)} exercices</span></div>
          </div>
          <div class="rang__actions"><button class="b b--fin b--trait" data-ouvrir-cycle="${echappe(c.id)}">Ouvrir</button></div>
        </div>`;
      }).join('') || '<div class="rien">Aucun cycle pour l\'instant.</div>'}
    </div>

    ${sansSchema.length ? `<div class="k">
      <h2 class="k__titre">${sansSchema.length} exercice${sansSchema.length > 1 ? 's' : ''} sans schéma</h2>
      <p class="k__note">Le site peut en proposer un tout seul à partir de ce qui est déjà écrit.</p>
      ${sansSchema.slice(0, 6).map(({ e, s }) => `<div class="rang">
        <div class="rang__corps"><strong>${echappe(e.titre)}</strong><div class="rang__meta"><span>${echappe(s.titre)}</span></div></div>
        <div class="rang__actions"><button class="b b--fin b--or" data-corriger="${echappe(s.id)}">Compléter</button></div>
      </div>`).join('')}
    </div>` : ''}

    <div class="k">
      <h2 class="k__titre">Publication</h2>
      <p class="k__note">${echappe(d.proprietaire)}/${echappe(d.nom)} · branche ${echappe(d.branche)}</p>
      <p style="font-size:.9rem;color:var(--encre-douce)">
        ${etat.connecte
          ? 'Clé enregistrée : chaque enregistrement part dans le dépôt et le site se reconstruit en une à deux minutes.'
          : '<strong>Aucune clé enregistrée.</strong> Les données affichées viennent du site en ligne et rien ne peut être publié. Va dans Réglages.'}
      </p>
      <p style="margin-top:12px"><a class="b b--fin b--trait" target="_blank" rel="noopener"
        href="https://${echappe(d.proprietaire.toLowerCase())}.github.io/${echappe(d.nom)}/">Voir le site en ligne ↗</a></p>
    </div>`;

  $$('[data-ouvrir-cycle]').forEach((b) => b.addEventListener('click', () => { montrer('seances'); }));
  $$('[data-corriger]').forEach((b) => b.addEventListener('click', () => {
    montrer('seances');
    formulaireSeance(etat.seances.find((s) => s.id === b.dataset.corriger));
  }));
}

/* ================================ cycles ================================ */

function vueCycles() {
  $('#vue-cycles').innerHTML = `
    <div class="adm-titre">
      <h1>Cycles</h1>
      <div class="adm-titre__actions"><button class="b b--or" id="nouveau-cycle">+ Nouveau cycle</button></div>
      <p>Un cycle regroupe les séances d'une même activité, dans l'ordre où on les vit.</p>
    </div>
    <div id="formulaire-cycle"></div>
    <div id="liste-cycles">${etat.cycles.map((c) => {
      const n = etat.seances.filter((s) => s.cycle === c.id).length;
      return `<div class="rang">
        <span class="rang__num">${n}</span>
        <div class="rang__corps">
          <strong>${echappe(c.titre)}</strong>
          <div class="rang__meta"><span class="etiquette">${echappe(c.sport)}</span><span>${echappe(c.niveaux || '')}</span><span>${echappe(c.periode || '')}</span><span>${c.duree}′</span></div>
        </div>
        <div class="rang__actions">
          <button class="b b--fin b--trait" data-modifier-cycle="${echappe(c.id)}">Modifier</button>
          <button class="b b--fin b--danger" data-supprimer-cycle="${echappe(c.id)}">Supprimer</button>
        </div>
      </div>`;
    }).join('') || '<div class="rien">Aucun cycle. Commence par en créer un : les séances s\'y rattachent.</div>'}</div>`;

  $('#nouveau-cycle').addEventListener('click', () => formulaireCycle(null));
  $$('[data-modifier-cycle]').forEach((b) => b.addEventListener('click', () =>
    formulaireCycle(etat.cycles.find((c) => c.id === b.dataset.modifierCycle))));
  $$('[data-supprimer-cycle]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.supprimerCycle;
    const liees = etat.seances.filter((s) => s.cycle === id).length;
    if (!confirm(`Supprimer ce cycle ?${liees ? `\n\n${liees} séance(s) resteront sans cycle et disparaîtront du site.` : ''}`)) return;
    etat.cycles = etat.cycles.filter((c) => c.id !== id);
    if (await publier('cycles.json', etat.cycles, 'Suppression d’un cycle')) vueCycles();
  }));
}

function formulaireCycle(cycle) {
  const c = cycle || { couleur: 'azur', duree: 45 };
  const sports = (etat.config.sports || []).map((s) =>
    `<option value="${echappe(s)}" ${c.sport === s ? 'selected' : ''}>${echappe(s)}</option>`).join('');

  $('#formulaire-cycle').innerHTML = `
    <form class="k f" id="form-cycle" style="margin-bottom:18px">
      <h2 class="k__titre">${cycle ? 'Modifier le cycle' : 'Nouveau cycle'}</h2>
      <div class="duo">
        ${champ('c-titre', 'Titre du cycle', c.titre || '', { ph: 'Courir, sauter, lancer' })}
        <div class="champ"><label for="c-sport"><span class="champ__label">Activité</span></label>
          <select id="c-sport">${sports}<option value="__autre">Autre…</option></select></div>
        ${champ('c-niveaux', 'Niveaux', c.niveaux || '', { ph: 'CM1 · CM2' })}
        ${champ('c-periode', 'Période', c.periode || '', { ph: 'Période 3' })}
      </div>
      ${curseur({ id: 'c-duree', label: 'Durée type d’une séance', val: c.duree || 45, min: 15, max: 120, pas: 5 })}
      ${champ('c-resume', 'Résumé', c.resume || '', { zone: true, aide: 'une phrase, celle qui s’affiche sur la carte' })}
      ${champ('c-objectif', 'Objectif du cycle', c.objectif || '', { zone: true, aide: 'ce que l’élève doit avoir compris à la fin' })}
      ${champ('c-apprentissages', 'Ce que l’élève doit savoir faire', (c.apprentissages || []).join('\n'), { zone: true, aide: 'une ligne par item' })}
      ${champ('c-remarque', 'À savoir avant de lancer le cycle', c.remarque || '', { zone: true, aide: 'matériel à préparer, contrainte, sécurité' })}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="submit" class="b b--or">Enregistrer et publier</button>
        <button type="button" class="b b--trait" id="annuler-cycle">Annuler</button>
      </div>
    </form>`;

  brancherCurseurs($('#formulaire-cycle'));
  $('#annuler-cycle').addEventListener('click', () => { $('#formulaire-cycle').innerHTML = ''; });
  $('#c-sport').addEventListener('change', (e) => {
    if (e.target.value !== '__autre') return;
    const nom = prompt('Nom de l’activité ?');
    if (!nom) { e.target.value = etat.config.sports[0] || ''; return; }
    etat.config.sports = [...(etat.config.sports || []), nom];
    e.target.insertAdjacentHTML('afterbegin', `<option value="${echappe(nom)}" selected>${echappe(nom)}</option>`);
    e.target.value = nom;
  });

  $('#form-cycle').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = val('c-titre');
    if (!titre) { message('Il faut un titre.', 'erreur'); return; }
    const nouveau = {
      ...(cycle || {}),
      id: cycle ? cycle.id : identifiant(titre),
      titre, sport: val('c-sport'), niveaux: val('c-niveaux'), periode: val('c-periode'),
      duree: num('c-duree'), couleur: c.couleur || 'azur',
      resume: val('c-resume'), objectif: val('c-objectif'),
      apprentissages: lignes(val('c-apprentissages')), remarque: val('c-remarque'),
    };
    if (cycle) etat.cycles = etat.cycles.map((x) => (x.id === cycle.id ? nouveau : x));
    else {
      if (etat.cycles.some((x) => x.id === nouveau.id)) { message('Un cycle porte déjà ce titre.', 'erreur'); return; }
      etat.cycles = [...etat.cycles, nouveau];
    }
    if (await publier('cycles.json', etat.cycles, (cycle ? 'Modification' : 'Ajout') + ' du cycle « ' + titre + ' »')) {
      $('#formulaire-cycle').innerHTML = ''; vueCycles(); rafraichirCompteurs();
    }
  });
  $('#formulaire-cycle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================ séances ================================ */

function vueSeances() {
  const parCycle = etat.cycles.map((c) => ({ c, liste: etat.seances.filter((s) => s.cycle === c.id).sort((a, b) => (a.numero || 0) - (b.numero || 0)) }));
  const orphelines = etat.seances.filter((s) => !etat.cycles.some((c) => c.id === s.cycle));

  const bloc = (titre, liste) => `
    <div class="k">
      <h2 class="k__titre">${echappe(titre)}</h2>
      <p class="k__note">${liste.length} séance${liste.length > 1 ? 's' : ''}</p>
      ${liste.map((s) => {
        const total = (s.echauffement?.duree || 0) + (s.exercices || []).reduce((n, e) => n + (e.duree || 0), 0) + (s.retour?.duree || 0);
        const nbSch = (s.exercices || []).filter((e) => e.schema).length;
        return `<div class="rang">
          <span class="rang__num">${String(s.numero || 1).padStart(2, '0')}</span>
          <div class="rang__corps">
            <strong>${echappe(s.titre)}</strong>
            <div class="rang__meta">
              <span>${total}′</span><span>${(s.exercices || []).length} exercice(s)</span>
              <span class="etiquette${nbSch === (s.exercices || []).length && nbSch ? '' : ' etiquette--gris'}">${nbSch} schéma(s)</span>
              ${total !== s.duree ? `<span class="etiquette--or etiquette">annoncée ${s.duree}′</span>` : ''}
            </div>
          </div>
          <div class="rang__actions">
            <button class="b b--fin b--trait" data-modifier-seance="${echappe(s.id)}">Modifier</button>
            <button class="b b--fin b--trait" data-dupliquer-seance="${echappe(s.id)}">Dupliquer</button>
            <button class="b b--fin b--danger" data-supprimer-seance="${echappe(s.id)}">Supprimer</button>
          </div>
        </div>`;
      }).join('') || '<div class="rien">Aucune séance dans ce cycle.</div>'}
    </div>`;

  $('#vue-seances').innerHTML = `
    <div class="adm-titre">
      <h1>Séances</h1>
      <div class="adm-titre__actions"><button class="b b--or" id="nouvelle-seance">+ Nouvelle séance</button></div>
      <p>Chaque séance devient une fiche imprimable : déroulé minuté, schémas, matériel.</p>
    </div>
    <div id="formulaire-seance"></div>
    ${parCycle.map(({ c, liste }) => bloc(c.titre, liste)).join('')}
    ${orphelines.length ? bloc('Sans cycle', orphelines) : ''}`;

  $('#nouvelle-seance').addEventListener('click', () => formulaireSeance(null));
  $$('[data-modifier-seance]').forEach((b) => b.addEventListener('click', () =>
    formulaireSeance(etat.seances.find((s) => s.id === b.dataset.modifierSeance))));
  $$('[data-dupliquer-seance]').forEach((b) => b.addEventListener('click', async () => {
    const src = etat.seances.find((s) => s.id === b.dataset.dupliquerSeance);
    const copie = JSON.parse(JSON.stringify(src));
    copie.titre = src.titre + ' (copie)';
    copie.id = identifiant(copie.titre);
    copie.numero = etat.seances.filter((s) => s.cycle === src.cycle).length + 1;
    etat.seances = [...etat.seances, copie];
    if (await publier('seances.json', etat.seances, 'Duplication de « ' + src.titre + ' »')) { vueSeances(); rafraichirCompteurs(); }
  }));
  $$('[data-supprimer-seance]').forEach((b) => b.addEventListener('click', async () => {
    const s = etat.seances.find((x) => x.id === b.dataset.supprimerSeance);
    if (!confirm(`Supprimer la séance « ${s.titre} » ?\n\nCette action est définitive.`)) return;
    etat.seances = etat.seances.filter((x) => x.id !== s.id);
    if (await publier('seances.json', etat.seances, 'Suppression de la séance « ' + s.titre + ' »')) { vueSeances(); rafraichirCompteurs(); }
  }));
}

/* ---------------------- constructeur de schéma ---------------------- */

const brouillons = new Map();   // uid d'exercice -> schéma en cours

function texteExercice(uid) {
  const b = document.querySelector(`[data-uid="${uid}"]`);
  if (!b) return '';
  return ['titre', 'description', 'organisation'].map((n) => (b.querySelector(`[data-ex="${n}"]`) || {}).value || '').join(' ');
}

function reglagesModele(uid, id, params) {
  const m = S.modele(id);
  if (!m) return '';
  return m.champs.map((c) => {
    const v = params[c.cle];
    const nom = `sch-${uid}-${c.cle}`;
    if (c.type === 'curseur') {
      const pct = ((v - c.min) / (c.max - c.min)) * 100;
      return `<div class="champ duree">
        <span class="champ__label">${echappe(c.label)}</span>
        <div class="duree__haut"><span class="duree__val" data-val="${nom}">${v}</span><span class="duree__unite">${echappe(c.unite || '')}</span></div>
        <input type="range" id="${nom}" data-sch="${echappe(c.cle)}" min="${c.min}" max="${c.max}" step="${c.pas || 1}" value="${v}" style="--part:${pct}%" aria-label="${echappe(c.label)}">
      </div>`;
    }
    if (c.type === 'oui-non') {
      return `<label class="oui-non"><input type="checkbox" data-sch="${echappe(c.cle)}" ${v ? 'checked' : ''}>${echappe(c.label)}</label>`;
    }
    if (c.type === 'choix') {
      return `<div class="champ"><span class="champ__label">${echappe(c.label)}</span>
        <div class="segments" data-sch-choix="${echappe(c.cle)}">
          ${c.options.map(([k, t]) => `<button type="button" data-opt="${echappe(k)}" aria-pressed="${v === k}">${echappe(t)}</button>`).join('')}
        </div></div>`;
    }
    return `<div class="champ"><label><span class="champ__label">${echappe(c.label)}</span>
      <input type="text" data-sch="${echappe(c.cle)}" value="${echappe(v || '')}"></label></div>`;
  }).join('');
}

function dessinerConstructeur(uid) {
  const hote = document.querySelector(`[data-schema-hote="${uid}"]`);
  if (!hote) return;
  const sch = brouillons.get(uid);

  if (!sch) {
    const propose = S.detecter(texteExercice(uid));
    const m = propose ? S.modele(propose.modele) : null;
    hote.innerHTML = `
      <div class="sch">
        <div class="sch__tete"><strong>Schéma de mise en place</strong>
          <button type="button" class="b b--fin b--or" data-sch-creer="${uid}">Créer le schéma</button></div>
        <div class="sch__reglages" style="border:0">
          ${m ? `<div class="sch__suggestion"><b>Proposition d’après ce que tu as écrit</b>
                   <span><strong>${echappe(m.nom)}</strong> — ${echappe(m.quand)}</span></div>` : ''}
          <p class="sch__vide" style="padding:8px 0">Le site fabrique le dessin tout seul : tu réponds à trois ou quatre questions, il place les plots, les élèves et les flèches.</p>
        </div>
      </div>`;
    hote.querySelector('[data-sch-creer]').addEventListener('click', () => {
      const p = S.detecter(texteExercice(uid)) || { modele: 'couloirs', params: S.valeursParDefaut('couloirs') };
      brouillons.set(uid, S.genererSchema(p.modele, p.params));
      dessinerConstructeur(uid);
    });
    return;
  }

  const idModele = sch.modele || null;
  const params = sch.params || {};

  hote.innerHTML = `
    <div class="sch">
      <div class="sch__tete">
        <strong>Schéma de mise en place</strong>
        <button type="button" class="b b--fin b--danger" data-sch-retirer="${uid}">Retirer</button>
      </div>
      <div class="sch__grille">
        <div class="sch__reglages">
          <div class="champ">
            <label for="sch-${uid}-modele"><span class="champ__label">Type de mise en place</span></label>
            <select id="sch-${uid}-modele" data-sch-modele="${uid}">
              ${S.MODELES.map((m) => `<option value="${m.id}" ${m.id === idModele ? 'selected' : ''}>${echappe(m.nom)}</option>`).join('')}
              ${idModele ? '' : '<option value="" selected>Schéma personnalisé</option>'}
            </select>
            ${idModele ? `<span class="champ__aide">${echappe(S.modele(idModele).quand)}</span>` : '<span class="champ__aide">Ce schéma a été dessiné à la main : il n’a pas de réglages. Le remplacer par un modèle le rendra modifiable au curseur.</span>'}
          </div>
          ${idModele ? '' : (() => {
            const sug = S.detecter(texteExercice(uid));
            if (!sug) return '';
            const m = S.modele(sug.modele);
            return `<div class="sch__suggestion"><b>Modèle suggéré d’après ce que tu as écrit</b>
              <span>${echappe(m.nom)}</span>
              <button type="button" class="b b--fin b--or" data-sch-adopter="${uid}">Le prendre</button></div>`;
          })()}
          ${idModele ? reglagesModele(uid, idModele, params) : ''}
        </div>
        <div class="sch__apercu" data-sch-apercu="${uid}">${S.figureSchema(sch, 'ap' + uid)}</div>
      </div>
    </div>`;

  const reGenerer = () => {
    const cour = brouillons.get(uid);
    if (!cour || !cour.modele) return;
    const p = { ...cour.params };
    const zone = hote.querySelector('.sch__reglages');
    $$('[data-sch]', zone).forEach((c) => {
      p[c.dataset.sch] = c.type === 'checkbox' ? c.checked : (c.type === 'range' ? Number(c.value) : c.value);
    });
    $$('[data-sch-choix]', zone).forEach((g) => {
      const actif = g.querySelector('[aria-pressed="true"]');
      if (actif) p[g.dataset.schChoix] = actif.dataset.opt;
    });
    const neuf = S.genererSchema(cour.modele, p);
    brouillons.set(uid, neuf);
    hote.querySelector(`[data-sch-apercu="${uid}"]`).innerHTML = S.figureSchema(neuf, 'ap' + uid + Date.now());
  };

  $$('[data-sch]', hote).forEach((c) => {
    c.addEventListener('input', () => {
      if (c.type === 'range') {
        c.style.setProperty('--part', ((c.value - c.min) / (c.max - c.min)) * 100 + '%');
        const t = hote.querySelector(`[data-val="${c.id}"]`);
        if (t) t.textContent = c.value;
      }
      reGenerer();
    });
    c.addEventListener('change', reGenerer);
  });
  $$('[data-sch-choix] button', hote).forEach((b) => b.addEventListener('click', () => {
    $$('button', b.parentElement).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    reGenerer();
  }));
  const adopter = hote.querySelector('[data-sch-adopter]');
  if (adopter) adopter.addEventListener('click', () => {
    const sug = S.detecter(texteExercice(uid));
    brouillons.set(uid, S.genererSchema(sug.modele, sug.params));
    dessinerConstructeur(uid);
  });

  hote.querySelector('[data-sch-modele]').addEventListener('change', (e) => {
    if (!e.target.value) return;
    brouillons.set(uid, S.genererSchema(e.target.value, S.valeursParDefaut(e.target.value)));
    dessinerConstructeur(uid);
  });
  hote.querySelector('[data-sch-retirer]').addEventListener('click', () => {
    if (!confirm('Retirer le schéma de cet exercice ?')) return;
    brouillons.set(uid, null);
    dessinerConstructeur(uid);
  });
}

/* -------------------- formulaire de séance -------------------- */

let compteurUid = 0;

function blocExercice(ex = {}, i = 0) {
  const uid = 'x' + (++compteurUid);
  brouillons.set(uid, ex.schema || null);
  return `
    <div class="ex" data-exercice data-uid="${uid}">
      <div class="ex__tete">
        <span class="ex__num">${i + 1}</span>
        <span class="ex__titre" data-ex-titre>${echappe(ex.titre || 'Nouvel exercice')}</span>
        <span class="etiquette etiquette--gris" data-ex-duree>${ex.duree || 15}′</span>
        <span class="ex__outils">
          <button type="button" class="ex__bouton" data-monter title="Monter" aria-label="Monter l'exercice">↑</button>
          <button type="button" class="ex__bouton" data-descendre title="Descendre" aria-label="Descendre l'exercice">↓</button>
          <button type="button" class="ex__bouton" data-replier title="Replier" aria-label="Replier l'exercice">▾</button>
          <button type="button" class="ex__bouton ex__bouton--danger" data-retirer title="Supprimer" aria-label="Supprimer l'exercice">✕</button>
        </span>
      </div>
      <div class="ex__corps">
        <div class="champ"><label><span class="champ__label">Titre de l'exercice</span>
          <input type="text" data-ex="titre" value="${echappe(ex.titre || '')}" placeholder="Course en boucle repérée"></label></div>

        <div class="champ duree">
          <span class="champ__label">Durée</span>
          <div class="duree__haut"><span class="duree__val" data-val="d-${uid}">${ex.duree || 15}</span><span class="duree__unite">min</span></div>
          <input type="range" id="d-${uid}" data-ex="duree" min="1" max="60" value="${ex.duree || 15}" aria-label="Durée de l'exercice">
        </div>

        <div class="champ"><label><span class="champ__label">Ce qu'on fait</span>
          <textarea data-ex="description" placeholder="Un circuit de 200 m jalonné de plots numérotés…">${echappe(ex.description || '')}</textarea></label></div>

        <div class="duo">
          <div class="champ"><label><span class="champ__label">Organisation du groupe</span>
            <input type="text" data-ex="organisation" value="${echappe(ex.organisation || '')}" placeholder="Deux vagues : une court, l'autre observe"></label></div>
          <div class="champ"><label><span class="champ__label">Variable si ça coince</span>
            <input type="text" data-ex="variable" value="${echappe(ex.variable || '')}" placeholder="Réduire à quatre minutes"></label></div>
        </div>

        <div class="champ"><label><span class="champ__label">Réussi si…</span>
          <input type="text" data-ex="reussite" value="${echappe(ex.reussite || '')}" placeholder="Le plot atteint est noté sans hésitation"></label></div>

        <div class="champ"><label><span class="champ__label">Ce qu'on regarde <span class="champ__aide">une ligne par point d'observation</span></span>
          <textarea data-ex="observer" rows="3" placeholder="Qui part trop vite et marche avant la fin.">${echappe((ex.observer || []).join('\n'))}</textarea></label></div>

        <div class="champ"><label><span class="champ__label">Consigne de sécurité <span class="champ__aide">à laisser vide s'il n'y en a pas</span></span>
          <input type="text" data-ex="securite" value="${echappe(ex.securite || '')}" placeholder="Personne ne dépasse la ligne avant le signal"></label></div>

        <div data-schema-hote="${uid}"></div>
      </div>
    </div>`;
}

function recalculerBilan() {
  const form = $('#form-seance');
  if (!form) return;
  const ech = num('s-ech-duree');
  const ret = num('s-ret-duree');
  const exs = $$('#liste-exercices [data-exercice]').map((b) => Number(b.querySelector('[data-ex="duree"]').value) || 0);
  const total = ech + ret + exs.reduce((a, b) => a + b, 0);
  const vise = num('s-duree');

  $('#bilan-total').textContent = total;
  $('#bilan-vise').textContent = vise;

  const large = Math.max(total, vise) || 1;
  const part = (d, genre) => `<div class="bilan__part bilan__part--${genre}" style="flex:${d} 1 0"></div>`;
  $('#bilan-piste').innerHTML = part(ech, 'ech') + exs.map((d) => part(d, 'ex')).join('') + part(ret, 'ret') +
    (total < vise ? `<div class="bilan__part" style="flex:${vise - total} 1 0;background:var(--craie-creuse)"></div>` : '');

  const v = $('#bilan-verdict');
  if (total === vise) { v.textContent = 'La séance tombe juste.'; v.style.color = 'var(--azur)'; }
  else if (total < vise) { v.textContent = `Il reste ${vise - total}′ à placer.`; v.style.color = 'var(--or-profond)'; }
  else { v.textContent = `Dépassement de ${total - vise}′.`; v.style.color = '#A8320F'; }
}

function formulaireSeance(seance) {
  const s = seance || { duree: 45, echauffement: { duree: 10 }, retour: { duree: 5 }, exercices: [{}] };
  brouillons.clear();
  const optionsCycles = etat.cycles.map((c) =>
    `<option value="${echappe(c.id)}" ${s.cycle === c.id ? 'selected' : ''}>${echappe(c.titre)}</option>`).join('');

  $('#formulaire-seance').innerHTML = `
    <form class="k f" id="form-seance" style="margin-bottom:22px">
      <h2 class="k__titre">${seance ? 'Modifier la séance' : 'Nouvelle séance'}</h2>

      <div class="f__bloc">
        <h3>L'essentiel</h3>
        <div class="duo">
          <div class="champ"><label for="s-cycle"><span class="champ__label">Cycle</span></label>
            <select id="s-cycle" required>${optionsCycles || '<option value="">— aucun cycle —</option>'}</select></div>
          ${champ('s-numero', 'Numéro dans le cycle', String(s.numero || etat.seances.filter((x) => x.cycle === s.cycle).length + 1), { type: 'number' })}
        </div>
        ${champ('s-titre', 'Titre de la séance', s.titre || '', { ph: "Courir sans s'arrêter" })}
        <div class="duo">
          ${curseur({ id: 's-duree', label: 'Durée annoncée', val: s.duree || 45, min: 15, max: 120, pas: 5 })}
          ${champ('s-lieu', 'Lieu', s.lieu || '', { ph: 'Cour, stade, bassin…' })}
        </div>
        ${champ('s-objectif', 'Objectif de la séance', s.objectif || '', { zone: true, aide: 'ce que l’élève apprend ici' })}
        ${champ('s-critere', 'Critère de réussite', s.critere || '', { zone: true, aide: 'annonçable aux élèves en une phrase' })}
      </div>

      <div class="f__bloc">
        <h3>Échauffement</h3>
        <div class="duo">
          ${champ('s-ech-titre', 'Intitulé', s.echauffement?.titre || '', { ph: 'Mise en train progressive' })}
          ${curseur({ id: 's-ech-duree', label: 'Durée', val: s.echauffement?.duree || 10, min: 0, max: 30, or: true })}
        </div>
        ${champ('s-ech-contenu', 'Contenu', s.echauffement?.contenu || '', { zone: true })}
      </div>

      <div class="f__bloc">
        <div class="f__barre">
          <h3 style="margin:0">Exercices <span id="compte-exercices"></span></h3>
          <div class="f__barre__actions">
            <button type="button" class="b b--fin b--trait" id="tout-replier">Tout replier</button>
            <button type="button" class="b b--fin b--or" id="ajouter-exercice-haut">+ Ajouter un exercice</button>
          </div>
        </div>
        <div id="liste-exercices">${(s.exercices || []).map(blocExercice).join('')}</div>
        <button type="button" class="ajout-exercice" id="ajouter-exercice">
          <span>+</span> Ajouter un exercice
        </button>
      </div>

      <div class="f__bloc">
        <h3>Retour au calme</h3>
        <div class="duo">
          ${champ('s-ret-titre', 'Intitulé', s.retour?.titre || 'Retour au calme')}
          ${curseur({ id: 's-ret-duree', label: 'Durée', val: s.retour?.duree || 5, min: 0, max: 20, or: true })}
        </div>
        ${champ('s-ret-contenu', 'Contenu', s.retour?.contenu || '', { zone: true })}
      </div>

      <div class="f__bloc">
        <h3>Matériel</h3>
        ${champ('s-materiel', 'À sortir du local', (s.materiel || []).join('\n'), { zone: true, aide: 'une ligne par élément, avec la quantité', ph: '10 plots numérotés\n1 chronomètre' })}
      </div>

      <div class="bilan">
        <div class="bilan__haut">
          <b id="bilan-total">0</b><span>′ de déroulé, pour <span id="bilan-vise">45</span>′ annoncées</span>
          <span class="bilan__verdict" id="bilan-verdict"></span>
        </div>
        <div class="bilan__piste" id="bilan-piste"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button type="submit" class="b b--or">Enregistrer et publier</button>
          <button type="button" class="b b--trait" id="annuler-seance">Annuler</button>
        </div>
      </div>
    </form>`;

  const zone = $('#formulaire-seance');
  brancherCurseurs(zone);
  $$('#liste-exercices [data-exercice]').forEach((b) => dessinerConstructeur(b.dataset.uid));
  brancherExercices();
  recalculerBilan();

  zone.addEventListener('input', (e) => {
    if (e.target.matches('[data-ex="duree"], #s-ech-duree, #s-ret-duree, #s-duree')) recalculerBilan();
    if (e.target.matches('[data-ex="titre"]')) {
      const b = e.target.closest('[data-exercice]');
      b.querySelector('[data-ex-titre]').textContent = e.target.value || 'Nouvel exercice';
    }
    if (e.target.matches('[data-ex="duree"]')) {
      e.target.closest('[data-exercice]').querySelector('[data-ex-duree]').textContent = e.target.value + '′';
    }
  });

  const ajouterExercice = () => {
    const n = $$('#liste-exercices [data-exercice]').length;
    $('#liste-exercices').insertAdjacentHTML('beforeend', blocExercice({}, n));
    const dernier = $('#liste-exercices').lastElementChild;
    brancherCurseurs(dernier);
    dessinerConstructeur(dernier.dataset.uid);
    brancherExercices();
    recalculerBilan();
    dernier.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const champTitre = dernier.querySelector('[data-ex="titre"]');
    if (champTitre) champTitre.focus();
  };
  $('#ajouter-exercice').addEventListener('click', ajouterExercice);
  $('#ajouter-exercice-haut').addEventListener('click', ajouterExercice);

  $('#tout-replier').addEventListener('click', (e) => {
    const blocs = $$('#liste-exercices [data-exercice]');
    const onReplie = blocs.some((b) => !b.classList.contains('replie'));
    blocs.forEach((b) => {
      b.classList.toggle('replie', onReplie);
      b.querySelector('[data-replier]').textContent = onReplie ? '▸' : '▾';
    });
    e.currentTarget.textContent = onReplie ? 'Tout déplier' : 'Tout replier';
  });

  $('#annuler-seance').addEventListener('click', () => { $('#formulaire-seance').innerHTML = ''; });
  $('#form-seance').addEventListener('submit', (e) => { e.preventDefault(); enregistrerSeance(seance); });
  zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function brancherExercices() {
  const liste = $('#liste-exercices');
  const renumeroter = () => {
    const blocs = $$('[data-exercice]', liste);
    blocs.forEach((b, i) => {
      b.querySelector('.ex__num').textContent = i + 1;
      b.querySelector('[data-monter]').disabled = i === 0;
      b.querySelector('[data-descendre]').disabled = i === blocs.length - 1;
    });
    const compte = $('#compte-exercices');
    if (compte) compte.textContent = '· ' + blocs.length;
  };

  $$('[data-exercice]', liste).forEach((b) => {
    b.querySelector('[data-monter]').onclick = () => {
      const p = b.previousElementSibling; if (p) { liste.insertBefore(b, p); renumeroter(); recalculerBilan(); }
    };
    b.querySelector('[data-descendre]').onclick = () => {
      const n = b.nextElementSibling; if (n) { liste.insertBefore(n, b); renumeroter(); recalculerBilan(); }
    };
    b.querySelector('[data-replier]').onclick = (e) => {
      const replie = b.classList.toggle('replie');
      e.currentTarget.textContent = replie ? '▸' : '▾';
    };
    b.querySelector('[data-retirer]').onclick = () => {
      if ($$('[data-exercice]', liste).length <= 1) { message('Une séance garde au moins un exercice.', 'erreur'); return; }
      if (!confirm('Supprimer cet exercice ?')) return;
      brouillons.delete(b.dataset.uid);
      b.remove(); renumeroter(); recalculerBilan();
    };
  });
  renumeroter();
}

async function enregistrerSeance(seance) {
  const titre = val('s-titre');
  if (!titre) { message('Il faut un titre de séance.', 'erreur'); return; }

  const anciens = (seance && seance.exercices) || [];
  const exercices = $$('#liste-exercices [data-exercice]').map((b, i) => {
    const lu = (n) => ((b.querySelector(`[data-ex="${n}"]`) || {}).value || '').trim();
    const t = lu('titre');
    const ancien = anciens.find((a) => a.titre === t) || anciens[i] || {};
    const r = {
      ...ancien, titre: t,
      duree: Number(lu('duree')) || 10,
      description: lu('description'),
      organisation: lu('organisation'),
      variable: lu('variable'),
    };
    const reussite = lu('reussite'); reussite ? (r.reussite = reussite) : delete r.reussite;
    const obs = lignes(lu('observer')); obs.length ? (r.observer = obs) : delete r.observer;
    const secu = lu('securite'); secu ? (r.securite = secu) : delete r.securite;
    const sch = brouillons.get(b.dataset.uid);
    sch ? (r.schema = sch) : delete r.schema;
    return r;
  }).filter((x) => x.titre);

  if (!exercices.length) { message('Donne au moins un titre à un exercice.', 'erreur'); return; }

  const nouvelle = {
    ...(seance || {}),
    id: seance ? seance.id : identifiant(titre),
    cycle: val('s-cycle'),
    numero: num('s-numero') || 1,
    titre,
    duree: num('s-duree') || 45,
    lieu: val('s-lieu'),
    objectif: val('s-objectif'),
    critere: val('s-critere'),
    echauffement: { ...((seance && seance.echauffement) || {}), titre: val('s-ech-titre'), duree: num('s-ech-duree'), contenu: val('s-ech-contenu') },
    exercices,
    retour: { ...((seance && seance.retour) || {}), titre: val('s-ret-titre'), duree: num('s-ret-duree'), contenu: val('s-ret-contenu') },
    materiel: lignes(val('s-materiel')),
    publiee: true,
  };

  if (seance) etat.seances = etat.seances.map((x) => (x.id === seance.id ? nouvelle : x));
  else {
    if (etat.seances.some((x) => x.id === nouvelle.id)) { message('Une séance porte déjà ce titre.', 'erreur'); return; }
    etat.seances = [...etat.seances, nouvelle];
  }
  if (await publier('seances.json', etat.seances, (seance ? 'Modification' : 'Ajout') + ' de la séance « ' + titre + ' »')) {
    $('#formulaire-seance').innerHTML = '';
    vueSeances(); rafraichirCompteurs();
  }
}

/* =============================== exercices =============================== */

function tousLesExercices() {
  const liste = [];
  etat.seances.forEach((s) => (s.exercices || []).forEach((ex, i) => {
    liste.push({ ex, i, seance: s, cycle: etat.cycles.find((c) => c.id === s.cycle) || null });
  }));
  return liste;
}

function vueExercices() {
  const tous = tousLesExercices();
  const sports = [...new Set(tous.map((x) => (x.cycle ? x.cycle.sport : 'Sans cycle')))];
  const sansSchema = tous.filter((x) => !x.ex.schema).length;

  $('#vue-exercices').innerHTML = `
    <div class="adm-titre">
      <h1>Exercices</h1>
      <p>Tous les exercices déjà écrits, toutes séances confondues. Utile pour retrouver une situation, la corriger, ou la recopier dans une autre séance.</p>
    </div>

    <div class="chiffres">
      <div class="k"><b>${tous.length}</b><span>exercices</span></div>
      <div class="k"><b>${tous.length - sansSchema}</b><span>avec schéma</span></div>
      <div class="k"><b>${sansSchema}</b><span>sans schéma</span></div>
    </div>

    <div class="champ" style="max-width:420px;margin-bottom:12px">
      <label for="ex-q"><span class="champ__label">Chercher</span></label>
      <input type="text" id="ex-q" placeholder="plots, passes, frite…">
    </div>
    <div class="segments" style="margin-bottom:18px">
      <button type="button" data-filtre="" aria-pressed="true">Tous</button>
      ${sports.map((s) => `<button type="button" data-filtre="${echappe(s)}" aria-pressed="false">${echappe(s)}</button>`).join('')}
      <button type="button" data-filtre="__sans" aria-pressed="false">Sans schéma</button>
    </div>

    <div id="liste-exos">
      ${tous.map((x, k) => `
        <div class="k" data-exo="${k}" data-sport="${echappe(x.cycle ? x.cycle.sport : 'Sans cycle')}"
             data-schema="${x.ex.schema ? '1' : '0'}"
             data-texte="${echappe([x.ex.titre, x.ex.description, x.ex.organisation, x.seance.titre].join(' ').toLowerCase())}"
             style="display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:18px;align-items:stretch">
          <div style="display:flex;flex-direction:column">
            <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:8px">
              <span class="etiquette">${x.ex.duree || 0}′</span>
              <span class="etiquette etiquette--gris">${echappe(x.cycle ? x.cycle.sport : 'Sans cycle')}</span>
              ${x.ex.schema ? '' : '<span class="etiquette etiquette--or">sans schéma</span>'}
              ${x.ex.securite ? '<span class="etiquette etiquette--or">sécurité</span>' : ''}
            </div>
            <h3 class="k__titre">${echappe(x.ex.titre)}</h3>
            <p class="k__note">${echappe(x.ex.description || '')}</p>
            <p style="font-family:var(--chrono);font-size:.72rem;color:var(--encre-pale)">Séance ${x.seance.numero} — ${echappe(x.seance.titre)}</p>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:auto;padding-top:14px">
              <button class="b b--fin b--trait" data-ouvrir="${echappe(x.seance.id)}">Modifier</button>
              <button class="b b--fin b--trait" data-copier="${k}">Copier vers une séance…</button>
            </div>
          </div>
          <div>${x.ex.schema ? S.figureSchema(x.ex.schema, 'ex' + k) : '<div class="rien" style="padding:26px 10px">Pas de schéma</div>'}</div>
        </div>`).join('') || '<div class="rien">Aucun exercice pour l\'instant.</div>'}
    </div>
    <p class="rien" id="exos-vide" hidden>Aucun exercice ne correspond.</p>`;

  const cartes = $$('#liste-exos [data-exo]');
  const q = $('#ex-q');
  let filtre = '';
  const appliquer = () => {
    const mot = (q.value || '').trim().toLowerCase();
    let n = 0;
    cartes.forEach((c) => {
      const okF = !filtre || (filtre === '__sans' ? c.dataset.schema === '0' : c.dataset.sport === filtre);
      const okM = !mot || c.dataset.texte.indexOf(mot) !== -1;
      c.hidden = !(okF && okM); if (okF && okM) n++;
    });
    $('#exos-vide').hidden = n > 0;
  };
  q.addEventListener('input', appliquer);
  $$('.segments [data-filtre]').forEach((b) => b.addEventListener('click', () => {
    filtre = b.dataset.filtre;
    $$('.segments [data-filtre]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    appliquer();
  }));

  $$('[data-ouvrir]').forEach((b) => b.addEventListener('click', () => {
    montrer('seances');
    formulaireSeance(etat.seances.find((s) => s.id === b.dataset.ouvrir));
  }));

  $$('[data-copier]').forEach((b) => b.addEventListener('click', async () => {
    const x = tous[Number(b.dataset.copier)];
    const cibles = etat.seances.filter((s) => s.id !== x.seance.id);
    if (!cibles.length) { message('Il n’y a pas d’autre séance où le copier.', 'erreur'); return; }
    const choix = prompt(
      'Copier « ' + x.ex.titre + ' » dans quelle séance ?\n\n' +
      cibles.map((s, i) => (i + 1) + '. ' + s.titre).join('\n') + '\n\nNuméro :');
    const i = Number(choix) - 1;
    if (!(i >= 0 && i < cibles.length)) return;
    const cible = cibles[i];
    cible.exercices = [...(cible.exercices || []), JSON.parse(JSON.stringify(x.ex))];
    etat.seances = etat.seances.map((s) => (s.id === cible.id ? cible : s));
    if (await publier('seances.json', etat.seances, 'Copie de l’exercice « ' + x.ex.titre + ' »')) {
      message('Copié dans « ' + cible.titre + ' ».', 'ok');
      vueExercices(); rafraichirCompteurs();
    }
  }));
}

/* =============================== ressources =============================== */

function vueRessources() {
  $('#vue-ressources').innerHTML = `
    <div class="adm-titre">
      <h1>Ressources</h1>
      <p>Documents à télécharger et articles. Les PDF sont déposés ici, jamais directement sur GitHub.</p>
    </div>

    <form class="k f" id="form-ressource" style="margin-bottom:18px">
      <h2 class="k__titre">Ajouter une ressource</h2>
      <div class="duo">
        ${champ('r-titre', 'Titre', '')}
        <div class="champ"><label for="r-type"><span class="champ__label">Type</span></label>
          <select id="r-type"><option value="PDF">Document PDF</option><option value="Article">Article</option></select></div>
      </div>
      ${champ('r-categorie', 'Catégorie', '', { ph: 'Observation, organisation…' })}
      ${champ('r-description', 'Description', '', { zone: true })}
      <div class="champ" id="bloc-fichier">
        <label for="r-fichier"><span class="champ__label">Fichier PDF <span class="champ__aide">10 Mo maximum</span></span></label>
        <input type="file" id="r-fichier" accept="application/pdf">
      </div>
      <div class="champ" id="bloc-contenu" hidden>
        <label for="r-contenu"><span class="champ__label">Texte de l'article</span></label>
        <textarea id="r-contenu" rows="6"></textarea>
      </div>
      <div><button type="submit" class="b b--or">Ajouter et publier</button></div>
    </form>

    <div>${etat.ressources.map((r) => `
      <div class="rang">
        <div class="rang__corps"><strong>${echappe(r.titre)}</strong>
          <div class="rang__meta"><span class="etiquette">${echappe(r.type || 'Document')}</span><span>${echappe(r.categorie || '')}</span></div>
        </div>
        <div class="rang__actions"><button class="b b--fin b--danger" data-supprimer-ressource="${echappe(r.id)}">Supprimer</button></div>
      </div>`).join('') || '<div class="rien">Aucune ressource.</div>'}</div>`;

  $('#r-type').addEventListener('change', (e) => {
    const pdf = e.target.value === 'PDF';
    $('#bloc-fichier').hidden = !pdf;
    $('#bloc-contenu').hidden = pdf;
  });

  $$('[data-supprimer-ressource]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Supprimer cette ressource ?')) return;
    etat.ressources = etat.ressources.filter((r) => r.id !== b.dataset.supprimerRessource);
    if (await publier('ressources.json', etat.ressources, 'Suppression d’une ressource')) { vueRessources(); rafraichirCompteurs(); }
  }));

  $('#form-ressource').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = val('r-titre');
    if (!titre) { message('Il faut un titre.', 'erreur'); return; }
    const type = val('r-type');
    const ressource = {
      id: identifiant(titre), titre, type,
      categorie: val('r-categorie'), description: val('r-description'),
    };

    if (type === 'PDF') {
      const f = $('#r-fichier').files[0];
      if (!f) { message('Choisis un fichier PDF.', 'erreur'); return; }
      if (f.size > 10 * 1024 * 1024) { message('Le fichier dépasse 10 Mo.', 'erreur'); return; }
      const octets = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
      const nom = ressource.id + '.pdf';
      try {
        await ecrireFichier('public/documents/' + nom, btoa(bin), 'Dépôt du document « ' + titre + ' »');
        ressource.fichier = nom;
      } catch (err) { message('Dépôt impossible : ' + err.message, 'erreur'); return; }
    } else {
      ressource.contenu = val('r-contenu');
    }

    etat.ressources = [ressource, ...etat.ressources];
    if (await publier('ressources.json', etat.ressources, 'Ajout de la ressource « ' + titre + ' »')) { vueRessources(); rafraichirCompteurs(); }
  });
}

/* ================================ réglages ================================ */

function blocCoffre() {
  const aCoffre = !!(etat.coffre && etat.coffre.donnee);
  const aJeton = !!jeton();

  if (!aCoffre) return `
    <form class="k f" id="form-coffre">
      <h2 class="k__titre">Retrouver sa clé sur n'importe quel appareil</h2>
      <p class="k__note">
        La clé peut être rangée <strong>chiffrée</strong> dans le dépôt. Il suffira ensuite d'une phrase de passe
        pour la récupérer sur un autre ordinateur, un autre navigateur ou un téléphone.
      </p>
      <div class="sch__suggestion">
        <b>La phrase de passe est la seule protection</b>
        <span>Le fichier chiffré est téléchargeable par n'importe qui, puisque le site est public. Prends quatre ou cinq
        mots sans rapport entre eux — <em>bassin cerise tortue lampadaire</em>. Pas le code d'accès du site. Elle n'est
        enregistrée nulle part et ne peut pas être retrouvée.</span>
      </div>
      ${aJeton ? '' : '<p class="k__note"><em>Enregistre d’abord une clé ci-dessus.</em></p>'}
      <div class="duo">
        <div class="champ"><label for="g-phrase1"><span class="champ__label">Phrase de passe</span></label>
          <input type="password" id="g-phrase1" autocomplete="new-password" ${aJeton ? '' : 'disabled'}></div>
        <div class="champ"><label for="g-phrase2"><span class="champ__label">Confirmer</span></label>
          <input type="password" id="g-phrase2" autocomplete="new-password" ${aJeton ? '' : 'disabled'}></div>
      </div>
      <div><button type="submit" class="b b--or" ${aJeton ? '' : 'disabled'}>Ranger la clé dans le dépôt</button></div>
    </form>`;

  if (!aJeton) return `
    <form class="k f" id="form-ouvrir">
      <h2 class="k__titre">Déverrouiller la clé</h2>
      <p class="k__note">Une clé chiffrée est rangée dans le dépôt. Saisis la phrase de passe pour la récupérer sur cet appareil.</p>
      <div class="champ"><label for="g-ouvrir"><span class="champ__label">Phrase de passe</span></label>
        <input type="password" id="g-ouvrir" autocomplete="off"></div>
      <div><button type="submit" class="b b--or">Déverrouiller</button></div>
    </form>`;

  return `
    <form class="k f" id="form-coffre">
      <h2 class="k__titre">Clé rangée dans le dépôt</h2>
      <p class="k__note">Elle est disponible sur tous les appareils, à condition de connaître la phrase de passe.
        Après avoir remplacé la clé ci-dessus, ou pour changer de phrase, range-la à nouveau.</p>
      <div class="duo">
        <div class="champ"><label for="g-phrase1"><span class="champ__label">Nouvelle phrase de passe</span></label>
          <input type="password" id="g-phrase1" autocomplete="new-password"></div>
        <div class="champ"><label for="g-phrase2"><span class="champ__label">Confirmer</span></label>
          <input type="password" id="g-phrase2" autocomplete="new-password"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="submit" class="b b--or">Ranger à nouveau</button>
        <button type="button" class="b b--danger" id="vider-coffre">Retirer du dépôt</button>
      </div>
    </form>`;
}

function vueReglages() {
  const d = etat.config.depot;
  $('#vue-reglages').innerHTML = `
    <div class="adm-titre"><h1>Réglages</h1></div>

    <form class="k f" id="form-jeton">
      <h2 class="k__titre">Clé d'accès au dépôt</h2>
      <p class="k__note">
        À créer sur GitHub : <em>Settings → Developer settings → Personal access tokens → Fine-grained tokens</em>,
        en n'autorisant que le dépôt <strong>${echappe(d.nom)}</strong>, avec <strong>Contents</strong> et
        <strong>Workflows</strong> en <em>Read and write</em>.
      </p>
      <div class="champ"><label for="g-jeton"><span class="champ__label">Clé</span></label>
        <input id="g-jeton" type="password" autocomplete="off" placeholder="${jeton() ? '•••••••••••••••• (enregistrée)' : 'github_pat_…'}"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="submit" class="b b--or">Enregistrer et tester</button>
        <button type="button" class="b b--danger" id="oublier-jeton">Oublier sur cet appareil</button>
      </div>
    </form>

    ${blocCoffre()}

    <form class="k f" id="form-code">
      <h2 class="k__titre">Changer le code d'accès</h2>
      <p class="k__note">Le code lui-même n'est jamais stocké : seule son empreinte l'est.</p>
      <div class="duo">
        <div class="champ"><label for="g-code1"><span class="champ__label">Nouveau code</span></label>
          <input id="g-code1" type="password" autocomplete="new-password"></div>
        <div class="champ"><label for="g-code2"><span class="champ__label">Confirmer</span></label>
          <input id="g-code2" type="password" autocomplete="new-password"></div>
      </div>
      <div><button type="submit" class="b b--or">Changer le code</button></div>
    </form>

    <form class="k f" id="form-textes">
      <h2 class="k__titre">Textes de la page d'accueil</h2>
      ${champ('g-accroche', 'Phrase d’accroche', etat.config.accroche || '')}
      ${champ('g-soustitre', 'Paragraphe d’introduction', etat.config.sousTitre || '', { zone: true })}
      <div><button type="submit" class="b b--or">Enregistrer et publier</button></div>
    </form>`;

  $('#form-jeton').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = val('g-jeton');
    if (v) { try { localStorage.setItem(CLE_JETON, v); } catch (_) {} }
    if (!jeton()) { message('Aucune clé saisie.', 'erreur'); return; }
    await verifierConnexion(true);
    vueReglages();
  });

  $('#oublier-jeton').addEventListener('click', () => {
    try { localStorage.removeItem(CLE_JETON); } catch (_) {}
    etat.connecte = false;
    afficherEtatDepot('Dépôt : non connecté', '');
    message('Clé oubliée sur cet appareil.');
    vueReglages();
  });

  const fc = $('#form-coffre');
  if (fc) fc.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#g-phrase1').value, b = $('#g-phrase2').value;
    if (a.length < 16) { message('Phrase trop courte : seize caractères au minimum, quatre mots font l’affaire.', 'erreur'); return; }
    if (a !== b) { message('Les deux phrases ne correspondent pas.', 'erreur'); return; }
    if (!jeton()) { message('Aucune clé à ranger.', 'erreur'); return; }
    try {
      const coffre = await fabriquerCoffre(a, jeton());
      if (await publier('cle.json', coffre, 'Clé chiffrée rangée dans le dépôt')) {
        etat.coffre = coffre;
        message('Clé rangée. Elle sera récupérable partout dans une à deux minutes.', 'ok');
        vueReglages();
      }
    } catch (err) { message('Chiffrement impossible : ' + err.message, 'erreur'); }
  });

  const vc = $('#vider-coffre');
  if (vc) vc.addEventListener('click', async () => {
    if (await publier('cle.json', { version: 1, vide: true }, 'Retrait de la clé chiffrée')) {
      etat.coffre = null;
      message('Clé retirée du dépôt.');
      vueReglages();
    }
  });

  const fo = $('#form-ouvrir');
  if (fo) fo.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phrase = $('#g-ouvrir').value;
    if (!phrase) { message('Saisis la phrase de passe.', 'erreur'); return; }
    try {
      const v = await ouvrirCoffre(phrase, etat.coffre);
      try { localStorage.setItem(CLE_JETON, v); } catch (_) {}
      message('Clé récupérée sur cet appareil.', 'ok');
      await verifierConnexion(true);
      vueReglages();
    } catch (_) { message('Phrase de passe incorrecte.', 'erreur'); }
  });

  $('#form-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#g-code1').value, b = $('#g-code2').value;
    if (a.length < 8) { message('Choisis un code d’au moins 8 caractères.', 'erreur'); return; }
    if (a !== b) { message('Les deux codes ne correspondent pas.', 'erreur'); return; }
    const octets = new TextEncoder().encode(etat.config.admin.sel + a);
    const resume = await crypto.subtle.digest('SHA-256', octets);
    etat.config.admin.empreinte = Array.from(new Uint8Array(resume)).map((o) => o.toString(16).padStart(2, '0')).join('');
    if (await publier('config.json', etat.config, 'Changement du code d’accès')) {
      sessionStorage.setItem('mse-acces', etat.config.admin.empreinte);
      message('Code changé. Il sera actif une fois le site reconstruit.', 'ok');
      vueReglages();
    }
  });

  $('#form-textes').addEventListener('submit', async (e) => {
    e.preventDefault();
    etat.config.accroche = val('g-accroche');
    etat.config.sousTitre = val('g-soustitre');
    await publier('config.json', etat.config, 'Mise à jour des textes du site');
  });
}

/* =============================== navigation =============================== */

const VUES = { tableau: vueTableau, cycles: vueCycles, seances: vueSeances, exercices: vueExercices, ressources: vueRessources, reglages: vueReglages };

function rafraichirCompteurs() {
  const mettre = (id, n) => { const e = $(id); if (e) e.textContent = n; };
  mettre('#n-cycles', etat.cycles.length);
  mettre('#n-seances', etat.seances.length);
  mettre('#n-exercices', etat.seances.reduce((n, s) => n + (s.exercices || []).length, 0));
  mettre('#n-ressources', etat.ressources.length);
}

function montrer(vue) {
  $$('.adm-onglet').forEach((o) => o.setAttribute('aria-current', o.dataset.vue === vue ? 'page' : 'false'));
  $$('.adm-vue').forEach((v) => v.classList.toggle('actif', v.id === 'vue-' + vue));
  (VUES[vue] || VUES.tableau)();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function verifierConnexion(bavard) {
  if (!jeton()) {
    etat.connecte = false;
    afficherEtatDepot('Dépôt : non connecté', '');
    return false;
  }
  try {
    await chargerDepuisGitHub();
    etat.connecte = true;
    afficherEtatDepot('Dépôt connecté', 'pastille--ok');
    if (bavard) message('Clé valide : les publications sont possibles.', 'ok');
    rafraichirCompteurs();
    return true;
  } catch (e) {
    etat.connecte = false;
    afficherEtatDepot('Clé refusée', 'pastille--erreur');
    message('Connexion au dépôt impossible : ' + e.message, 'erreur');
    return false;
  }
}

/* ================================= départ ================================= */

async function depart() {
  etat.config = await fetch(BASE + 'data/config.json').then((r) => r.json());

  if (sessionStorage.getItem('mse-acces') !== etat.config.admin.empreinte) {
    window.location.replace(BASE);
    return;
  }

  $('#garde').hidden = true;
  $('#appli').hidden = false;

  await chargerLocal();
  await chargerCoffre();
  await verifierConnexion(false);
  rafraichirCompteurs();

  $$('.adm-onglet').forEach((o) => o.addEventListener('click', () => montrer(o.dataset.vue)));
  $('#quitter').addEventListener('click', () => sessionStorage.removeItem('mse-acces'));

  if (!jeton() && etat.coffre) {
    montrer('reglages');
    message('Clé absente de cet appareil : saisis la phrase de passe pour la récupérer.');
  } else {
    montrer('tableau');
  }
}

depart().catch((e) => {
  const g = $('#garde');
  if (g) g.textContent = 'Chargement impossible : ' + e.message;
});
