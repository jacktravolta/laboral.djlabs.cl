// chat-datos.js — deterministic extraction of the person's OWN data.
//
// The model only ever sees anonymized placeholders, so it can NEVER hand back
// a real datum. This module is the one that reads the ORIGINAL text of the
// person — a chat message or the text already extracted in the browser from an
// attachment — and maps it onto the fields of the written document that is
// being prepared.
//
// Rules:
//   - only the fields declared by the CURRENT type can be produced;
//   - a value exists only when the text says it (label-anchored);
//   - a RUT survives only when the shared validator accepts it;
//   - amounts and dates stay literal ("$480.000", "01-03-2021");
//   - what the person wrote by hand in the form always wins (the caller owns
//     that rule: this module only says what the text contained).

import { isValidRutCl } from './topup.js';

// Label anchors per field. The label the API sends is added on top of these,
// so a type that renames a field still works.
const SINONIMOS = {
  nombre_completo: ['nombre', 'me llamo', 'soy'],
  rut: ['rut', 'rut personal'],
  email: ['correo', 'correo electrónico', 'email', 'e-mail'],
  telefono: ['teléfono', 'celular', 'móvil'],
  razon_social: ['razón social', 'trabajo en', 'mi empresa', 'empleador'],
  rut_empresa: ['RUT de la empresa', 'RUT del empleador', 'RUT de la compañía'],
  fecha_ingreso: ['fecha de ingreso', 'entré el', 'fecha que ingressé'],
  ultimo_sueldo: ['última remuneración', 'último sueldo', 'remuneración', 'sueldo'],
};

// Fields whose value is a RUT: the personal one first, the company one after.
const ORDEN_RUT = ['rut', 'rut_empresa'];

// Lead-in words between the label and the value ("... es X", "...: X").
const CONECTOR = /^\s*(?:(?:es|son|fue|era|ser[aá])\s+)?(?::|=|-)?\s*/i;

// Trailing noise: punctuation and the connector words that introduce the NEXT
// label ("..., mi RUT es ..." → the value stops before "mi").
const RUIDO_FINAL = /\s+(?:y|e|and|mi|mis|el|la|los|las|que|de|del|en|con|para|por|además|ademas|o|u)$/i;

/**
 * Lowercase + accent-free copy of the text plus the index map back to the
 * original, so the value can be sliced WITHOUT losing its accents or case.
 *
 * @param {string} texto
 * @returns {{ norm: string, mapa: number[] }}
 */
function normalizar(texto) {
  const original = String(texto || '');
  let norm = '';
  const mapa = [];

  for (let i = 0; i < original.length; i++) {
    const plano = original[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    for (const caracter of plano) {
      norm += caracter.toLowerCase();
      mapa.push(i);
    }
  }

  return { norm, mapa };
}

/**
 * Anchors of the text: the labels + synonyms of the CURRENT type (these
 * produce values) and the WHOLE vocabulary (these only mark where a value
 * ends, so a field of a type that has no "RUT" still stops at "mi RUT es…").
 *
 * @param {Array<{key?: string, label?: string}>} campos
 * @returns {Array<{key: string, frase: string, produce: boolean}>}
 */
function construirAnchores(campos) {
  const porFrase = new Map();

  const agregar = (key, frase, produce) => {
    const norm = normalizar(frase).norm;
    if (!norm) return;

    const actual = porFrase.get(norm);
    if (actual) {
      if (produce && !actual.produce) {
        actual.produce = true;
        actual.key = key;
      }
      return;
    }

    porFrase.set(norm, { key, frase: norm, produce });
  };

  for (const campo of campos) {
    const key = campo && campo.key ? campo.key : '';
    if (!key) continue;

    const label = campo && campo.label ? String(campo.label).trim() : '';
    if (label) agregar(key, label, true);

    for (const sinonimo of SINONIMOS[key] || []) agregar(key, sinonimo, true);
  }

  for (const key of Object.keys(SINONIMOS)) {
    for (const sinonimo of SINONIMOS[key]) agregar(key, sinonimo, false);
  }

  return Array.from(porFrase.values());
}

/**
 * Shape of the value of a field, from its key and its label.
 *
 * @param {{key?: string, label?: string}} campo
 * @returns {'rut'|'email'|'telefono'|'fecha'|'monto'|'texto'}
 */
function tipoDeCampo(campo) {
  const key = String((campo && campo.key) || '').toLowerCase();
  const label = normalizar((campo && campo.label) || '').norm;

  if (key === 'rut' || key === 'rut_empresa') return 'rut';
  if (key === 'email') return 'email';
  if (key === 'telefono') return 'telefono';
  if (key === 'fecha_ingreso') return 'fecha';
  if (key === 'ultimo_sueldo') return 'monto';

  if (/rut/.test(label)) return 'rut';
  if (/correo|email/.test(label)) return 'email';
  if (/telefono|celular|movil/.test(label)) return 'telefono';
  if (/fecha/.test(label)) return 'fecha';
  if (/remuneracion|sueldo|monto/.test(label)) return 'monto';

  return 'texto';
}

/**
 * Every occurrence of an anchor. At the same position the LONGEST anchor wins
 * ("RUT de la empresa" beats "RUT"), and an anchor inside another one is
 * dropped ("remuneración" inside "última remuneración").
 *
 * @param {string} norm
 * @param {Array<{key: string, frase: string, produce: boolean}>} anclas
 * @returns {Array<{key: string, inicio: number, fin: number, produce: boolean}>}
 */
function escanearAnclas(norm, anclas) {
  const encontradas = [];

  for (const ancla of anclas) {
    let desde = 0;

    while (desde <= norm.length) {
      const pos = norm.indexOf(ancla.frase, desde);
      if (pos === -1) break;

      const fin = pos + ancla.frase.length;

      // Word boundaries: "soy" inside "estoy" is not an anchor, and "correo"
      // inside "ana.soto@correo.cl" is part of the value, not a label.
      const antes = pos > 0 ? norm[pos - 1] : '';
      const despues = fin < norm.length ? norm[fin] : '';

      const bordeOk = !/[a-z0-9]/.test(antes)
        && !/[a-z0-9]/.test(despues)
        && antes !== '@';

      if (bordeOk) {
        encontradas.push({ key: ancla.key, inicio: pos, fin, produce: ancla.produce });
      }

      desde = pos + 1;
    }
  }

  encontradas.sort((a, b) => (a.inicio - b.inicio) || (b.fin - a.fin));

  const unicas = [];
  let ultimaFin = -1;

  for (const ancla of encontradas) {
    if (ancla.inicio < ultimaFin) continue;
    unicas.push(ancla);
    ultimaFin = ancla.fin;
  }

  return unicas;
}

/**
 * RUT-shaped candidates of a text.
 *
 * @param {string} texto
 * @returns {Array<{valor: string, inicio: number}>}
 */
function buscarRuts(texto) {
  const salida = [];
  const re = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dKk]\b/g;
  let match = re.exec(texto);

  while (match !== null) {
    salida.push({ valor: match[0], inicio: match.index });
    match = re.exec(texto);
  }

  return salida;
}

/**
 * Removes the trailing punctuation and the connector that introduces the next
 * label.
 *
 * @param {string} valor
 * @returns {string}
 */
function limpiarValor(valor) {
  let texto = String(valor || '');

  for (let i = 0; i < 10; i++) {
    const antes = texto;
    texto = texto.replace(/\s+$/, '');
    texto = texto.replace(/[.,;:!?]+$/, '');
    texto = texto.replace(RUIDO_FINAL, '');

    if (texto === antes) break;
  }

  return texto.trim();
}

/**
 * Value of one anchor: the text between this anchor and the next one, cut at
 * the sentence boundary, with the shape the field demands.
 *
 * @returns {{valor: string, ruts: number[]}}
 */
function valorDeAncla(original, mapa, ancla, siguiente, tipo, esRutValido) {
  const inicioNorm = ancla.fin;
  const finNorm = siguiente ? siguiente.inicio : null;

  const inicio = mapa[inicioNorm] !== undefined ? mapa[inicioNorm] : original.length;
  const fin = finNorm !== null && mapa[finNorm] !== undefined ? mapa[finNorm] : original.length;

  let region = original.slice(inicio, Math.max(fin, inicio));

  // A value never crosses a sentence.
  const corte = /[.!?;](?=\s|$)/.exec(region);
  if (corte) region = region.slice(0, corte.index);

  // The RUT candidates of the region, with their position in the ORIGINAL
  // text: it is measured BEFORE the lead-in word is stripped, otherwise the
  // position would be shifted and the same RUT could be taken twice.
  const ruts = buscarRuts(region).map((c) => inicio + c.inicio);

  // Lead-in word ("es", "fue", ":").
  region = region.replace(CONECTOR, '');

  // The whole rest of the sentence: a typed value (a mail, a RUT, a phone)
  // can hold a word that also looks like a label ("@correo.cl").
  let regionAncha = original.slice(inicio);
  const corteAncho = /[.!?;](?=\s|$)/.exec(regionAncha);
  if (corteAncho) regionAncha = regionAncha.slice(0, corteAncho.index);
  regionAncha = regionAncha.replace(CONECTOR, '');

  if (tipo === 'rut') {
    // The RUT stays inside its own region: a wider search could take the
    // RUT of the employer for the personal one.
    for (const candidato of buscarRuts(region)) {
      if (esRutValido(candidato.valor)) return { valor: candidato.valor, ruts };
    }
    return { valor: '', ruts };
  }

  if (tipo === 'email') {
    const patron = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const m = patron.exec(region) || patron.exec(regionAncha);
    return { valor: m ? m[0] : '', ruts };
  }

  if (tipo === 'telefono') {
    const patron = /(?:\+?56[\s.-]?)?9[\s.-]?\d{4}[\s.-]?\d{4}/;
    const m = patron.exec(region) || patron.exec(regionAncha)
      || /\+?\d{8,12}/.exec(region) || /\+?\d{8,12}/.exec(regionAncha);
    return { valor: m ? m[0].trim() : '', ruts };
  }

  if (tipo === 'fecha') {
    const m = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.exec(region);
    return { valor: m ? m[0] : '', ruts };
  }

  if (tipo === 'monto') {
    const m = /\$\s?\d[\d.,]*|\b\d{1,3}(?:\.\d{3})+(?:,\d{3})*\b/.exec(region);
    return { valor: m ? limpiarValor(m[0]) : '', ruts };
  }

  return { valor: limpiarValor(region), ruts };
}

/**
 * Extracts the data the person said, for the fields of the given type.
 *
 * @param {string} texto Original text of the person (chat or attachment).
 * @param {{ campos?: Array<{key?: string, label?: string}>, esRutValido?: (value: string) => boolean }} [opciones]
 * @returns {Object<string, string>}
 */
export function extraerDatos(texto, opciones = {}) {
  const campos = Array.isArray(opciones.campos) ? opciones.campos : [];
  const esRutValido = typeof opciones.esRutValido === 'function' ? opciones.esRutValido : isValidRutCl;
  const original = String(texto || '');

  if (original.trim() === '' || campos.length === 0) return {};

  const { norm, mapa } = normalizar(original);
  const anclas = construirAnchores(campos);
  const encontradas = escanearAnclas(norm, anclas);

  const porClave = new Map();
  for (const campo of campos) {
    if (campo && campo.key && !porClave.has(campo.key)) porClave.set(campo.key, campo);
  }

  const datos = {};
  const rutsReclamados = new Set();

  for (let i = 0; i < encontradas.length; i++) {
    const ancla = encontradas[i];
    const siguiente = encontradas[i + 1] || null;
    const campo = porClave.get(ancla.key);

    const tipo = campo ? tipoDeCampo(campo) : 'texto';
    const { valor, ruts } = valorDeAncla(original, mapa, ancla, siguiente, tipo, esRutValido);

    // Every RUT of a labelled region belongs to that label: it is never
    // reused as an unlabelled one.
    for (const posicion of ruts) rutsReclamados.add(posicion);

    if (!ancla.produce || !campo) continue;
    if (valor === '') continue;
    if (datos[ancla.key] === undefined) datos[ancla.key] = valor;
  }

  // RUTs without a label: the first is the personal one, the second the
  // company's. The ones already claimed by a label are never reused.
  const clavesRut = [];
  for (const key of ORDEN_RUT) {
    if (porClave.has(key) && tipoDeCampo(porClave.get(key)) === 'rut') clavesRut.push(key);
  }
  for (const [key, campo] of porClave) {
    if (clavesRut.indexOf(key) === -1 && tipoDeCampo(campo) === 'rut') clavesRut.push(key);
  }

  if (clavesRut.length > 0) {
    for (const candidato of buscarRuts(original)) {
      if (rutsReclamados.has(candidato.inicio)) continue;

      const destino = clavesRut.find((key) => datos[key] === undefined);
      if (!destino) break;
      if (!esRutValido(candidato.valor)) continue;

      datos[destino] = candidato.valor;
      rutsReclamados.add(candidato.inicio);
    }
  }

  return datos;
}

// ---- Module store: what the person said, ready for the form ----

const store = new Map();
const textos = [];

/**
 * Registers extracted data. The newest value of a key wins.
 *
 * @param {Object<string, string>} datos
 * @returns {Object<string, string>}
 */
export function registrarDatos(datos) {
  if (datos && typeof datos === 'object') {
    for (const clave of Object.keys(datos)) {
      const valor = String(datos[clave] === undefined || datos[clave] === null ? '' : datos[clave]).trim();
      if (valor === '') continue;
      store.set(clave, valor);
    }
  }

  return obtenerDatos();
}

/**
 * @returns {Object<string, string>} A copy of the store.
 */
export function obtenerDatos() {
  const salida = {};
  for (const [clave, valor] of store) salida[clave] = valor;
  return salida;
}

/**
 * Empties the store (the texts are kept: they are the source of truth).
 */
export function limpiarDatos() {
  store.clear();
}

/**
 * Keeps the original text of the person so it can be re-read against the
 * fields of another type of written document.
 *
 * @param {string} texto
 */
export function registrarTexto(texto) {
  const limpio = String(texto || '').trim();
  if (limpio === '') return;
  if (textos.indexOf(limpio) === -1) textos.push(limpio);
}

/**
 * @returns {string[]} A copy of the texts registered so far.
 */
export function obtenerTextos() {
  return textos.slice();
}

/**
 * Empties the texts (used when the person starts a new conversation).
 */
export function limpiarTextos() {
  textos.length = 0;
}
