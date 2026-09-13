// Associe une activité à son pictogramme et à sa teinte de carte.
const TABLE = [
  [/athl|cours|saut|lanc/i,       { picto: 'p-cone',     teinte: '' }],
  [/collectif|ballon|jeux de b/i, { picto: 'p-ballon',   teinte: 'carte--or' }],
  [/aquatiq|nat|eau|piscine/i,    { picto: 'p-vague',    teinte: 'carte--nuit' }],
  [/orientation|boussole/i,       { picto: 'p-boussole', teinte: '' }],
  [/raquette|badmin|tennis/i,     { picto: 'p-raquette', teinte: 'carte--or' }],
  [/coop|coll(a|é)bor/i,          { picto: 'p-mains',    teinte: '' }],
];

export function pictoDe(sport = '') {
  for (const [motif, valeur] of TABLE) if (motif.test(sport)) return valeur;
  return { picto: 'p-sifflet', teinte: '' };
}
