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
  boite.className = 'message' + (genre ? ' message--' + genre : '');
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
  badge.className = 'jeton jeton--attente';
  badge.textContent = 'Publication en cours…';
  try {
    await ecrireFichier('public/data/' + fichier, enBase64(JSON.stringify(donnees, null, 2) + '\n'), description);
    badge.className = 'jeton jeton--ok';
    badge.textContent = 'Publié — en ligne dans 1 à 2 min';
    message('Enregistré. Le site se met à jour dans une à deux minutes.', 'ok');
    setTimeout(() => { badge.hidden = true; }, 12000);
    return true;
  } catch (e) {
    badge.className = 'jeton jeton--erreur';
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
  badge.className = 'jeton ' + (genre || 'jeton--gris');
}

/* ------------------------------- vues ------------------------------- */

function vueTableau() {
  const d = etat.config.depot;
  const parCycle = etat.cycles
    .map((c) => `<li><strong>${echappe(c.titre)}</strong> — ${etat.seances.filter((s) => s.cycle === c.id).length} séance(s)</li>`)
    .join('');

  $('#vue-tableau').innerHTML = `
    <h1 class="titre-vue">Tableau de bord</h1>
    <div class="grille grille--3" style="padding-top:20px">
      <div class="carte"><div class="compteur">${etat.cycles.length}</div><div class="compteur__note">cycles</div></div>
      <div class="carte"><div class="compteur">${etat.seances.length}</div><div class="compteur__note">séances</div></div>
      <div class="carte"><div class="compteur">${etat.ressources.length}</div><div class="compteur__note">ressources</div></div>
    </div>

    <div class="carte" style="margin-top:24px">
      <h2 class="titre-bloc">Contenu publié</h2>
      <ul style="padding-left:18px;display:flex;flex-direction:column;gap:6px;margin-top:10px">${parCycle || '<li>Aucun cycle.</li>'}</ul>
    </div>

    <div class="carte" style="margin-top:20px">
      <h2 class="titre-bloc">Dépôt</h2>
      <p style="color:var(--gris);margin-top:8px">
        ${echappe(d.proprietaire)}/${echappe(d.nom)} · branche ${echappe(d.branche)}<br>
        Site public :
        <a href="https://${echappe(d.proprietaire.toLowerCase())}.github.io/${echappe(d.nom)}/" target="_blank" rel="noopener">
          ${echappe(d.proprietaire.toLowerCase())}.github.io/${echappe(d.nom)}/
        </a>
      </p>
      <p style="color:var(--gris);margin-top:10px">
        ${etat.connecte
          ? 'Clé enregistrée : les modifications partent directement dans le dépôt.'
          : 'Aucune clé enregistrée : les données affichées sont celles du site en ligne, et rien ne peut être publié. Va dans Réglages.'}
      </p>
    </div>`;
}

function vueCycles() {
  const cartes = etat.cycles.map((c) => `
    <article class="carte ligne">
      <div>
        <strong style="font-size:18px">${echappe(c.titre)}</strong>
        <div style="color:var(--gris);font-size:15px">${echappe(c.sport)} · ${echappe(c.niveaux)} · ${etat.seances.filter((s) => s.cycle === c.id).length} séance(s)</div>
      </div>
      <div class="ligne__actions">
        <button type="button" class="bouton bouton--fantome" data-modifier-cycle="${echappe(c.id)}">Modifier</button>
        <button type="button" class="bouton bouton--fantome bouton--danger" data-supprimer-cycle="${echappe(c.id)}">Supprimer</button>
      </div>
    </article>`).join('');

  $('#vue-cycles').innerHTML = `
    <div class="titre-vue__barre">
      <h1 class="titre-vue">Cycles</h1>
      <button type="button" class="bouton" id="nouveau-cycle">Nouveau cycle</button>
    </div>
    <div id="formulaire-cycle"></div>
    <div class="pile" style="gap:12px;padding-top:20px">${cartes || '<p style="color:var(--gris)">Aucun cycle pour l\'instant.</p>'}</div>`;

  $('#nouveau-cycle').addEventListener('click', () => formulaireCycle(null));
  $$('[data-modifier-cycle]').forEach((b) =>
    b.addEventListener('click', () => formulaireCycle(etat.cycles.find((c) => c.id === b.dataset.modifierCycle)))
  );
  $$('[data-supprimer-cycle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.supprimerCycle;
      const liees = etat.seances.filter((s) => s.cycle === id).length;
      if (!confirm(`Supprimer ce cycle ?${liees ? ` ${liees} séance(s) resteront sans cycle.` : ''}`)) return;
      etat.cycles = etat.cycles.filter((c) => c.id !== id);
      if (await publier('cycles.json', etat.cycles, 'Suppression d’un cycle')) vueCycles();
    })
  );
}

function formulaireCycle(cycle) {
  const c = cycle || { couleur: 'azur', duree: 45 };
  const sports = (etat.config.sports || []).map((s) =>
    `<option value="${echappe(s)}" ${c.sport === s ? 'selected' : ''}>${echappe(s)}</option>`).join('');

  $('#formulaire-cycle').innerHTML = `
    <form class="carte formulaire" id="form-cycle">
      <h2 class="titre-bloc">${cycle ? 'Modifier le cycle' : 'Nouveau cycle'}</h2>
      <div class="grille grille--2">
        <div><label for="c-titre">Titre</label><input id="c-titre" required value="${echappe(c.titre || '')}"></div>
        <div><label for="c-sport">Activité</label><select id="c-sport">${sports}<option value="__autre">Autre…</option></select></div>
        <div><label for="c-niveaux">Niveaux</label><input id="c-niveaux" placeholder="CM1 · CM2" value="${echappe(c.niveaux || '')}"></div>
        <div><label for="c-periode">Période</label><input id="c-periode" placeholder="Période 3" value="${echappe(c.periode || '')}"></div>
        <div><label for="c-duree">Durée d'une séance (min)</label><input id="c-duree" type="number" min="10" max="120" value="${echappe(c.duree || 45)}"></div>
        <div><label for="c-couleur">Couleur</label><select id="c-couleur">
          <option value="azur" ${c.couleur === 'azur' ? 'selected' : ''}>Bleu azur</option>
          <option value="or" ${c.couleur === 'or' ? 'selected' : ''}>Jaune or</option>
          <option value="azur-fonce" ${c.couleur === 'azur-fonce' ? 'selected' : ''}>Bleu foncé</option>
        </select></div>
      </div>
      <div><label for="c-resume">Résumé (une phrase)</label><input id="c-resume" value="${echappe(c.resume || '')}"></div>
      <div><label for="c-objectif">Objectif du cycle</label><textarea id="c-objectif">${echappe(c.objectif || '')}</textarea></div>
      <div><label for="c-apprentissages">Ce qu'ils apprennent (une ligne par point)</label><textarea id="c-apprentissages">${echappe((c.apprentissages || []).join('\n'))}</textarea></div>
      <div><label for="c-remarque">Bon à savoir (facultatif)</label><textarea id="c-remarque">${echappe(c.remarque || '')}</textarea></div>
      <div class="formulaire__actions">
        <button type="submit" class="bouton">Enregistrer et publier</button>
        <button type="button" class="bouton bouton--fantome" id="annuler-cycle">Annuler</button>
      </div>
    </form>`;

  $('#annuler-cycle').addEventListener('click', () => ($('#formulaire-cycle').innerHTML = ''));

  $('#c-sport').addEventListener('change', (e) => {
    if (e.target.value === '__autre') {
      const saisi = prompt('Nom de l’activité ?');
      if (saisi) {
        const opt = document.createElement('option');
        opt.value = saisi; opt.textContent = saisi; opt.selected = true;
        e.target.insertBefore(opt, e.target.firstChild);
      } else { e.target.selectedIndex = 0; }
    }
  });

  $('#form-cycle').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = $('#c-titre').value.trim();
    const nouveau = {
      id: cycle ? cycle.id : identifiant(titre),
      titre,
      sport: $('#c-sport').value,
      niveaux: $('#c-niveaux').value.trim(),
      periode: $('#c-periode').value.trim(),
      duree: Number($('#c-duree').value) || 45,
      couleur: $('#c-couleur').value,
      resume: $('#c-resume').value.trim(),
      objectif: $('#c-objectif').value.trim(),
      apprentissages: lignes($('#c-apprentissages').value),
      remarque: $('#c-remarque').value.trim(),
    };
    if (cycle) {
      etat.cycles = etat.cycles.map((x) => (x.id === cycle.id ? nouveau : x));
    } else {
      if (etat.cycles.some((x) => x.id === nouveau.id)) { message('Un cycle porte déjà ce titre.', 'erreur'); return; }
      etat.cycles = [nouveau, ...etat.cycles];
    }
    if (await publier('cycles.json', etat.cycles, (cycle ? 'Modification' : 'Ajout') + ' du cycle « ' + titre + ' »')) vueCycles();
  });

  $('#formulaire-cycle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function vueSeances() {
  const lignesSeances = etat.seances
    .slice()
    .sort((a, b) => String(a.cycle).localeCompare(String(b.cycle)) || (a.numero || 0) - (b.numero || 0))
    .map((s) => {
      const c = etat.cycles.find((x) => x.id === s.cycle);
      return `<article class="carte ligne">
        <div>
          <strong style="font-size:18px">${s.numero}. ${echappe(s.titre)}</strong>
          <div style="color:var(--gris);font-size:15px">${echappe(c ? c.titre : 'Cycle inconnu')} · ${s.duree} min · ${(s.exercices || []).length} exercice(s)</div>
        </div>
        <div class="ligne__actions">
          <button type="button" class="bouton bouton--fantome" data-modifier-seance="${echappe(s.id)}">Modifier</button>
          <button type="button" class="bouton bouton--fantome bouton--danger" data-supprimer-seance="${echappe(s.id)}">Supprimer</button>
        </div>
      </article>`;
    }).join('');

  $('#vue-seances').innerHTML = `
    <div class="titre-vue__barre">
      <h1 class="titre-vue">Séances</h1>
      <button type="button" class="bouton" id="nouvelle-seance">Nouvelle séance</button>
    </div>
    <div id="formulaire-seance"></div>
    <div class="pile" style="gap:12px;padding-top:20px">${lignesSeances || '<p style="color:var(--gris)">Aucune séance pour l\'instant.</p>'}</div>`;

  $('#nouvelle-seance').addEventListener('click', () => formulaireSeance(null));
  $$('[data-modifier-seance]').forEach((b) =>
    b.addEventListener('click', () => formulaireSeance(etat.seances.find((s) => s.id === b.dataset.modifierSeance)))
  );
  $$('[data-supprimer-seance]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Supprimer cette séance ?')) return;
      etat.seances = etat.seances.filter((s) => s.id !== b.dataset.supprimerSeance);
      if (await publier('seances.json', etat.seances, 'Suppression d’une séance')) vueSeances();
    })
  );
}

function blocExercice(ex = {}, i = 0) {
  return `
    <div class="exercice" data-exercice>
      <div class="exercice__entete">
        <strong>Exercice ${i + 1}</strong>
        <button type="button" class="bouton bouton--fantome bouton--danger" data-retirer-exercice>Retirer</button>
      </div>
      <div class="grille grille--2">
        <div><label>Titre</label><input data-ex="titre" value="${echappe(ex.titre || '')}"></div>
        <div><label>Durée (min)</label><input data-ex="duree" type="number" min="1" max="90" value="${echappe(ex.duree || 15)}"></div>
      </div>
      <div><label>Description</label><textarea data-ex="description">${echappe(ex.description || '')}</textarea></div>
      <div><label>Organisation</label><input data-ex="organisation" value="${echappe(ex.organisation || '')}"></div>
      <div><label>Variable (adaptation)</label><input data-ex="variable" value="${echappe(ex.variable || '')}"></div>
      <div><label>Réussi si…</label><input data-ex="reussite" value="${echappe(ex.reussite || '')}"></div>
      <div><label>Ce qu'on regarde <span style="color:var(--gris);font-weight:400">(une ligne par point)</span></label><textarea data-ex="observer" rows="3">${echappe((ex.observer || []).join('\n'))}</textarea></div>
      <div><label>Consigne de sécurité <span style="color:var(--gris);font-weight:400">(laisser vide s'il n'y en a pas)</span></label><input data-ex="securite" value="${echappe(ex.securite || '')}"></div>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:.85rem;color:var(--gris)">Schéma de terrain (avancé)</summary>
        <p style="color:var(--gris);font-size:.82rem;margin:8px 0">Description du schéma en JSON. Laisser vide pour ne pas en afficher. En cas d'erreur de saisie, l'ancien schéma est conservé.</p>
        <textarea data-ex="schema" rows="6" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.8rem">${echappe(ex.schema ? JSON.stringify(ex.schema) : '')}</textarea>
      </details>
    </div>`;
}

function formulaireSeance(seance) {
  const s = seance || { duree: 45, echauffement: { duree: 10 }, retour: { duree: 5 }, exercices: [{}] };
  const optionsCycles = etat.cycles
    .map((c) => `<option value="${echappe(c.id)}" ${s.cycle === c.id ? 'selected' : ''}>${echappe(c.titre)}</option>`).join('');

  $('#formulaire-seance').innerHTML = `
    <form class="carte formulaire" id="form-seance">
      <h2 class="titre-bloc">${seance ? 'Modifier la séance' : 'Nouvelle séance'}</h2>

      <div class="grille grille--2">
        <div><label for="s-cycle">Cycle</label><select id="s-cycle" required>${optionsCycles}</select></div>
        <div><label for="s-numero">Numéro dans le cycle</label><input id="s-numero" type="number" min="1" value="${echappe(s.numero || etat.seances.filter((x) => x.cycle === s.cycle).length + 1)}"></div>
        <div><label for="s-titre">Titre</label><input id="s-titre" required value="${echappe(s.titre || '')}"></div>
        <div><label for="s-duree">Durée totale (min)</label><input id="s-duree" type="number" min="10" max="120" value="${echappe(s.duree || 45)}"></div>
        <div><label for="s-lieu">Lieu</label><input id="s-lieu" placeholder="Cour, stade, bassin…" value="${echappe(s.lieu || '')}"></div>
      </div>

      <div><label for="s-objectif">Objectif d'apprentissage</label><textarea id="s-objectif">${echappe(s.objectif || '')}</textarea></div>
      <div><label for="s-critere">Critère de réussite</label><textarea id="s-critere">${echappe(s.critere || '')}</textarea></div>

      <h3 class="titre-bloc" style="margin-top:8px">Échauffement</h3>
      <div class="grille grille--2">
        <div><label for="s-ech-titre">Intitulé</label><input id="s-ech-titre" value="${echappe(s.echauffement?.titre || '')}"></div>
        <div><label for="s-ech-duree">Durée (min)</label><input id="s-ech-duree" type="number" min="1" max="30" value="${echappe(s.echauffement?.duree || 10)}"></div>
      </div>
      <div><label for="s-ech-contenu">Contenu</label><textarea id="s-ech-contenu">${echappe(s.echauffement?.contenu || '')}</textarea></div>

      <h3 class="titre-bloc" style="margin-top:8px">Exercices</h3>
      <div id="liste-exercices">${(s.exercices || []).map(blocExercice).join('')}</div>
      <button type="button" class="bouton bouton--fantome" id="ajouter-exercice" style="align-self:flex-start">+ Ajouter un exercice</button>

      <h3 class="titre-bloc" style="margin-top:8px">Retour au calme</h3>
      <div class="grille grille--2">
        <div><label for="s-ret-duree">Durée (min)</label><input id="s-ret-duree" type="number" min="1" max="20" value="${echappe(s.retour?.duree || 5)}"></div>
      </div>
      <div><label for="s-ret-contenu">Contenu</label><textarea id="s-ret-contenu">${echappe(s.retour?.contenu || '')}</textarea></div>

      <div><label for="s-materiel">Matériel (une ligne par élément)</label><textarea id="s-materiel" placeholder="12 plots&#10;4 cerceaux&#10;1 chronomètre">${echappe((s.materiel || []).join('\n'))}</textarea></div>

      <div class="formulaire__actions">
        <button type="submit" class="bouton">Enregistrer et publier</button>
        <button type="button" class="bouton bouton--fantome" id="annuler-seance">Annuler</button>
      </div>
    </form>`;

  const renumeroter = () => $$('#liste-exercices [data-exercice]').forEach((b, i) => {
    b.querySelector('.exercice__entete strong').textContent = 'Exercice ' + (i + 1);
  });

  const brancherRetraits = () => $$('[data-retirer-exercice]').forEach((b) => {
    b.onclick = () => {
      if ($$('#liste-exercices [data-exercice]').length <= 1) { message('Une séance garde au moins un exercice.', 'erreur'); return; }
      b.closest('[data-exercice]').remove();
      renumeroter();
    };
  });
  brancherRetraits();

  $('#ajouter-exercice').addEventListener('click', () => {
    $('#liste-exercices').insertAdjacentHTML('beforeend', blocExercice({}, $$('#liste-exercices [data-exercice]').length));
    brancherRetraits();
    renumeroter();
  });

  $('#annuler-seance').addEventListener('click', () => ($('#formulaire-seance').innerHTML = ''));

  $('#form-seance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = $('#s-titre').value.trim();
    const anciens = (seance && seance.exercices) || [];
    const exercices = $$('#liste-exercices [data-exercice]').map((bloc, i) => {
      const lu = (nom) => (bloc.querySelector('[data-ex="' + nom + '"]') || {}).value || '';
      const titre = lu('titre').trim();
      // on repart de l'ancien exercice pour ne rien perdre de ce que ce formulaire n'édite pas
      const ancien = anciens.find((a) => a.titre === titre) || anciens[i] || {};
      const resultat = {
        ...ancien,
        titre,
        duree: Number(lu('duree')) || 10,
        description: lu('description').trim(),
        organisation: lu('organisation').trim(),
        variable: lu('variable').trim(),
      };
      const reussite = lu('reussite').trim();
      if (reussite) resultat.reussite = reussite; else delete resultat.reussite;
      const observer = lignes(lu('observer'));
      if (observer.length) resultat.observer = observer; else delete resultat.observer;
      const securite = lu('securite').trim();
      if (securite) resultat.securite = securite; else delete resultat.securite;
      const brut = lu('schema').trim();
      if (!brut) { delete resultat.schema; }
      else {
        try { resultat.schema = JSON.parse(brut); }
        catch (_) { message('Schéma de « ' + titre + ' » illisible : l’ancien a été conservé.', 'erreur'); }
      }
      return resultat;
    }).filter((x) => x.titre);

    const nouvelle = {
      ...(seance || {}),
      id: seance ? seance.id : identifiant(titre),
      cycle: $('#s-cycle').value,
      numero: Number($('#s-numero').value) || 1,
      titre,
      duree: Number($('#s-duree').value) || 45,
      lieu: $('#s-lieu').value.trim(),
      objectif: $('#s-objectif').value.trim(),
      critere: $('#s-critere').value.trim(),
      echauffement: {
        titre: $('#s-ech-titre').value.trim(),
        duree: Number($('#s-ech-duree').value) || 10,
        contenu: $('#s-ech-contenu').value.trim(),
      },
      exercices,
      retour: {
        ...((seance && seance.retour) || {}),
        duree: Number($('#s-ret-duree').value) || 5,
        contenu: $('#s-ret-contenu').value.trim(),
      },
      materiel: lignes($('#s-materiel').value),
      publiee: true,
    };

    if (!exercices.length) { message('Ajoute au moins un exercice avec un titre.', 'erreur'); return; }

    if (seance) {
      etat.seances = etat.seances.map((x) => (x.id === seance.id ? nouvelle : x));
    } else {
      if (etat.seances.some((x) => x.id === nouvelle.id)) { message('Une séance porte déjà ce titre.', 'erreur'); return; }
      etat.seances = [...etat.seances, nouvelle];
    }
    if (await publier('seances.json', etat.seances, (seance ? 'Modification' : 'Ajout') + ' de la séance « ' + titre + ' »')) vueSeances();
  });

  $('#formulaire-seance').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function vueRessources() {
  const cartes = etat.ressources.map((r) => `
    <article class="carte ligne">
      <div>
        <strong style="font-size:18px">${echappe(r.titre)}</strong>
        <div style="color:var(--gris);font-size:15px">${r.type === 'pdf' ? 'PDF' : 'Article'} · ${echappe(r.categorie || '')}</div>
      </div>
      <div class="ligne__actions">
        <button type="button" class="bouton bouton--fantome bouton--danger" data-supprimer-ressource="${echappe(r.id)}">Retirer</button>
      </div>
    </article>`).join('');

  $('#vue-ressources').innerHTML = `
    <div class="titre-vue__barre"><h1 class="titre-vue">Ressources</h1></div>

    <form class="carte formulaire" id="form-ressource" style="margin-top:18px">
      <h2 class="titre-bloc">Ajouter une ressource</h2>
      <div class="grille grille--2">
        <div><label for="r-titre">Titre</label><input id="r-titre" required></div>
        <div><label for="r-type">Type</label><select id="r-type"><option value="pdf">Document PDF</option><option value="article">Article</option></select></div>
        <div><label for="r-categorie">Thème</label><input id="r-categorie" placeholder="Athlétisme, Sécurité, Organisation…"></div>
      </div>
      <div><label for="r-description">Description courte</label><input id="r-description"></div>
      <div id="champ-pdf"><label for="r-fichier">Fichier PDF</label><input id="r-fichier" type="file" accept="application/pdf"></div>
      <div id="champ-article" hidden><label for="r-contenu">Texte de l'article</label><textarea id="r-contenu" style="min-height:160px"></textarea></div>
      <div class="formulaire__actions"><button type="submit" class="bouton">Ajouter et publier</button></div>
    </form>

    <div class="pile" style="gap:12px;padding-top:20px">${cartes || '<p style="color:var(--gris)">Aucune ressource.</p>'}</div>`;

  $('#r-type').addEventListener('change', (e) => {
    const pdf = e.target.value === 'pdf';
    $('#champ-pdf').hidden = !pdf;
    $('#champ-article').hidden = pdf;
  });

  $$('[data-supprimer-ressource]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Retirer cette ressource de la liste ? Le fichier reste dans le dépôt.')) return;
      etat.ressources = etat.ressources.filter((r) => r.id !== b.dataset.supprimerRessource);
      if (await publier('ressources.json', etat.ressources, 'Retrait d’une ressource')) vueRessources();
    })
  );

  $('#form-ressource').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!etat.connecte) { message('Ajoute d’abord la clé du dépôt dans Réglages.', 'erreur'); return; }
    const titre = $('#r-titre').value.trim();
    const type = $('#r-type').value;
    const ressource = {
      id: identifiant(titre),
      titre,
      type,
      categorie: $('#r-categorie').value.trim() || 'Divers',
      description: $('#r-description').value.trim(),
    };

    if (type === 'pdf') {
      const fichier = $('#r-fichier').files[0];
      if (!fichier) { message('Choisis un fichier PDF.', 'erreur'); return; }
      if (fichier.size > 10 * 1024 * 1024) { message('Le PDF dépasse 10 Mo : allège-le avant de l’envoyer.', 'erreur'); return; }
      const nom = identifiant(titre) + '.pdf';
      const badge = $('#etat-publication');
      badge.hidden = false; badge.className = 'jeton jeton--attente'; badge.textContent = 'Envoi du PDF…';
      try {
        const tampon = new Uint8Array(await fichier.arrayBuffer());
        let binaire = '';
        for (let i = 0; i < tampon.length; i += 0x8000) binaire += String.fromCharCode.apply(null, tampon.subarray(i, i + 0x8000));
        await ecrireFichier('public/documents/' + nom, btoa(binaire), 'Ajout du document ' + nom);
        ressource.fichier = 'documents/' + nom;
      } catch (err) {
        badge.className = 'jeton jeton--erreur'; badge.textContent = 'Envoi impossible';
        message('Envoi du PDF impossible : ' + err.message, 'erreur');
        return;
      }
    } else {
      ressource.contenu = $('#r-contenu').value.trim();
    }

    etat.ressources = [ressource, ...etat.ressources];
    if (await publier('ressources.json', etat.ressources, 'Ajout de la ressource « ' + titre + ' »')) vueRessources();
  });
}

function blocCoffre() {
  const aCoffre = !!(etat.coffre && etat.coffre.donnee);
  const aJeton = !!jeton();

  if (!aCoffre) {
    return `
    <form class="carte formulaire" id="form-coffre" style="margin-top:20px">
      <h2 class="titre-bloc">Retrouver sa clé sur n'importe quel appareil</h2>
      <p style="color:var(--gris)">
        La clé peut être rangée dans le dépôt sous forme chiffrée. Il suffira alors d'une phrase de passe
        pour la récupérer sur un autre ordinateur, un autre navigateur ou un téléphone.
        <strong>Cette phrase est la seule protection</strong> : prends quatre ou cinq mots sans rapport entre eux,
        du genre « bassin cerise tortue lampadaire ». Pas le code d'accès du site, pas un mot de passe déjà utilisé ailleurs.
        Elle n'est enregistrée nulle part : perdue, il faudra refaire une clé sur GitHub.
      </p>
      ${aJeton ? '' : '<p style="color:var(--gris)"><em>Enregistre d’abord une clé ci-dessus.</em></p>'}
      <div class="grille grille--2">
        <div><label for="g-phrase1">Phrase de passe</label><input id="g-phrase1" type="password" autocomplete="new-password"${aJeton ? '' : ' disabled'}></div>
        <div><label for="g-phrase2">Confirmer</label><input id="g-phrase2" type="password" autocomplete="new-password"${aJeton ? '' : ' disabled'}></div>
      </div>
      <div class="formulaire__actions"><button type="submit" class="bouton"${aJeton ? '' : ' disabled'}>Ranger la clé dans le dépôt</button></div>
    </form>`;
  }

  if (!aJeton) {
    return `
    <form class="carte formulaire" id="form-ouvrir" style="margin-top:20px">
      <h2 class="titre-bloc">Déverrouiller la clé</h2>
      <p style="color:var(--gris)">
        Une clé chiffrée est rangée dans le dépôt. Saisis la phrase de passe pour la récupérer sur cet appareil.
      </p>
      <div><label for="g-ouvrir">Phrase de passe</label><input id="g-ouvrir" type="password" autocomplete="off"></div>
      <div class="formulaire__actions"><button type="submit" class="bouton">Déverrouiller</button></div>
    </form>`;
  }

  return `
    <form class="carte formulaire" id="form-coffre" style="margin-top:20px">
      <h2 class="titre-bloc">Clé rangée dans le dépôt</h2>
      <p style="color:var(--gris)">
        Elle est disponible sur tous les appareils, à condition de connaître la phrase de passe.
        Après avoir remplacé la clé ci-dessus, ou pour changer de phrase, range-la à nouveau.
      </p>
      <div class="grille grille--2">
        <div><label for="g-phrase1">Nouvelle phrase de passe</label><input id="g-phrase1" type="password" autocomplete="new-password"></div>
        <div><label for="g-phrase2">Confirmer</label><input id="g-phrase2" type="password" autocomplete="new-password"></div>
      </div>
      <div class="formulaire__actions">
        <button type="submit" class="bouton">Ranger à nouveau</button>
        <button type="button" class="bouton bouton--fantome bouton--danger" id="vider-coffre">Retirer du dépôt</button>
      </div>
    </form>`;
}

function vueReglages() {
  const d = etat.config.depot;
  $('#vue-reglages').innerHTML = `
    <h1 class="titre-vue">Réglages</h1>

    <form class="carte formulaire" id="form-jeton" style="margin-top:18px">
      <h2 class="titre-bloc">Clé d'accès au dépôt</h2>
      <p style="color:var(--gris)">
        Elle reste enregistrée dans ce navigateur, sur cet ordinateur uniquement. Elle n'est jamais publiée sur le site.
        À créer sur GitHub : <em>Settings → Developer settings → Personal access tokens → Fine-grained tokens</em>,
        en n'autorisant que le dépôt <strong>${echappe(d.nom)}</strong> avec la permission <strong>Contents : Read and write</strong>.
      </p>
      <div><label for="g-jeton">Clé</label><input id="g-jeton" type="password" placeholder="${jeton() ? '•••••••••••••••• (enregistrée)' : 'github_pat_…'}" autocomplete="off"></div>
      <div class="formulaire__actions">
        <button type="submit" class="bouton">Enregistrer et tester</button>
        <button type="button" class="bouton bouton--fantome bouton--danger" id="oublier-jeton">Oublier la clé</button>
      </div>
    </form>

    <form class="carte formulaire" id="form-code" style="margin-top:20px">
      <h2 class="titre-bloc">Changer le code d'accès</h2>
      <p style="color:var(--gris)">Le code lui-même n'est jamais stocké : seule son empreinte l'est.</p>
      <div class="grille grille--2">
        <div><label for="g-code1">Nouveau code</label><input id="g-code1" type="password" autocomplete="new-password"></div>
        <div><label for="g-code2">Confirmer</label><input id="g-code2" type="password" autocomplete="new-password"></div>
      </div>
      <div class="formulaire__actions"><button type="submit" class="bouton">Changer le code</button></div>
    </form>

    ${blocCoffre()}

    <div class="carte" style="margin-top:20px">
      <h2 class="titre-bloc">Textes du site</h2>
      <form class="formulaire" id="form-textes" style="padding-top:12px">
        <div><label for="g-accroche">Phrase d'accroche</label><input id="g-accroche" value="${echappe(etat.config.accroche || '')}"></div>
        <div><label for="g-soustitre">Paragraphe d'introduction</label><textarea id="g-soustitre">${echappe(etat.config.sousTitre || '')}</textarea></div>
        <div class="formulaire__actions"><button type="submit" class="bouton">Enregistrer et publier</button></div>
      </form>
    </div>`;

  $('#form-jeton').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valeur = $('#g-jeton').value.trim();
    if (valeur) { try { localStorage.setItem(CLE_JETON, valeur); } catch (_) {} }
    if (!jeton()) { message('Aucune clé saisie.', 'erreur'); return; }
    await verifierConnexion(true);
  });

  $('#oublier-jeton').addEventListener('click', () => {
    try { localStorage.removeItem(CLE_JETON); } catch (_) {}
    etat.connecte = false;
    afficherEtatDepot('Dépôt : non connecté', 'jeton--gris');
    message('Clé oubliée sur cet ordinateur.');
    vueReglages();
  });

  $('#form-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#g-code1').value, b = $('#g-code2').value;
    if (a.length < 8) { message('Choisis un code d’au moins 8 caractères.', 'erreur'); return; }
    if (a !== b) { message('Les deux codes ne correspondent pas.', 'erreur'); return; }
    const sel = etat.config.admin.sel;
    const octets = new TextEncoder().encode(sel + a);
    const resume = await crypto.subtle.digest('SHA-256', octets);
    etat.config.admin.empreinte = Array.from(new Uint8Array(resume)).map((o) => o.toString(16).padStart(2, '0')).join('');
    if (await publier('config.json', etat.config, 'Changement du code d’accès')) {
      sessionStorage.setItem('mse-acces', etat.config.admin.empreinte);
      message('Code changé. Il sera actif une fois le site reconstruit.', 'ok');
      vueReglages();
    }
  });


  const formCoffre = $('#form-coffre');
  if (formCoffre) {
    formCoffre.addEventListener('submit', async (e) => {
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
      } catch (err) {
        message('Chiffrement impossible : ' + err.message, 'erreur');
      }
    });
  }

  const viderCoffre = $('#vider-coffre');
  if (viderCoffre) {
    viderCoffre.addEventListener('click', async () => {
      if (await publier('cle.json', { version: 1, vide: true }, 'Retrait de la clé chiffrée')) {
        etat.coffre = null;
        message('Clé retirée du dépôt. Il faudra la recoller sur chaque appareil.');
        vueReglages();
      }
    });
  }

  const formOuvrir = $('#form-ouvrir');
  if (formOuvrir) {
    formOuvrir.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phrase = $('#g-ouvrir').value;
      if (!phrase) { message('Saisis la phrase de passe.', 'erreur'); return; }
      try {
        const valeur = await ouvrirCoffre(phrase, etat.coffre);
        try { localStorage.setItem(CLE_JETON, valeur); } catch (_) {}
        message('Clé récupérée sur cet appareil.', 'ok');
        await verifierConnexion(true);
        vueReglages();
      } catch (_) {
        message('Phrase de passe incorrecte.', 'erreur');
      }
    });
  }

  $('#form-textes').addEventListener('submit', async (e) => {
    e.preventDefault();
    etat.config.accroche = $('#g-accroche').value.trim();
    etat.config.sousTitre = $('#g-soustitre').value.trim();
    await publier('config.json', etat.config, 'Mise à jour des textes du site');
  });
}

/* ---------------------------- navigation ---------------------------- */

function montrer(vue) {
  $$('.onglet').forEach((o) => o.classList.toggle('est-actif', o.dataset.vue === vue));
  $$('.vue').forEach((v) => v.classList.toggle('est-visible', v.id === 'vue-' + vue));
  ({ tableau: vueTableau, cycles: vueCycles, seances: vueSeances, ressources: vueRessources, reglages: vueReglages }[vue])();
}

async function verifierConnexion(bavard) {
  if (!jeton()) {
    etat.connecte = false;
    afficherEtatDepot('Dépôt : non connecté', 'jeton--gris');
    return false;
  }
  try {
    await chargerDepuisGitHub();
    etat.connecte = true;
    afficherEtatDepot('Dépôt connecté', 'jeton--ok');
    if (bavard) message('Clé valide : les publications sont possibles.', 'ok');
    montrer($('.onglet.est-actif')?.dataset.vue || 'tableau');
    return true;
  } catch (e) {
    etat.connecte = false;
    afficherEtatDepot('Clé refusée', 'jeton--erreur');
    message('Connexion au dépôt impossible : ' + e.message, 'erreur');
    return false;
  }
}

/* ------------------------------ départ ------------------------------ */

async function depart() {
  etat.config = await fetch(BASE + 'data/config.json').then((r) => r.json());

  const acces = sessionStorage.getItem('mse-acces');
  if (acces !== etat.config.admin.empreinte) {
    window.location.replace(BASE);
    return;
  }

  $('#garde').hidden = true;
  $('#appli').hidden = false;

  await chargerLocal();
  await chargerCoffre();
  await verifierConnexion(false);

  $$('.onglet').forEach((o) => o.addEventListener('click', () => montrer(o.dataset.vue)));
  $('#quitter').addEventListener('click', () => sessionStorage.removeItem('mse-acces'));

  if (!jeton() && etat.coffre) {
    montrer('reglages');
    message('Clé absente de cet appareil : saisis la phrase de passe pour la récupérer.');
  } else {
    montrer('tableau');
  }
}

depart().catch((e) => {
  $('#garde').textContent = 'Chargement impossible : ' + e.message;
});
