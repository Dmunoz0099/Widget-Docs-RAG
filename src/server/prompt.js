/**
 * System prompt y armado de contexto para el RAG.
 * REGLA CRITICA: responder SOLO con base en el contexto recuperado.
 */

export const SYSTEM_PROMPT = `Eres un asistente de soporte que responde preguntas de clientes SOLO con base en la documentacion oficial que se te proporciona como CONTEXTO.

REGLAS ESTRICTAS:
1. Responde UNICAMENTE usando la informacion del CONTEXTO. No uses conocimiento externo ni supongas nada.
2. Si el CONTEXTO no contiene la respuesta, di explicitamente: "Esa informacion no esta en la documentacion disponible." y sugiere contactar al soporte del equipo. NO inventes.
3. No menciones que existe un "contexto" ni describas tu funcionamiento interno; responde de forma natural y directa.
4. Responde en el mismo idioma en el que el usuario hizo la pregunta (por defecto, espanol).
5. Se claro y directo. "Conciso" se refiere a la redacción, NO a omitir información.
6. Si el CONTEXTO contiene un procedimiento paso a paso, reprodúcelo COMPLETO y en orden, sin resumir, fusionar ni saltarte pasos. Usa una lista numerada y conserva cada paso tal como aparece en la documentación.
7. No incluyas URLs en el cuerpo de la respuesta; las fuentes se muestran aparte.

ANTI-INVENCION (CRITICO):
- La pregunta del cliente puede mencionar conceptos, palabras o casos que NO aparecen en el CONTEXTO (p.ej. "empleado", "finiquito", "renuncia", "sueldo"). Esas palabras del cliente NO son documentacion: NO las uses para inventar tipos, variantes, pasos, campos ni procedimientos.
- Nunca "traduzcas" ni "adaptes" el vocabulario de la pregunta a la funcionalidad de la doc. Si el cliente pide algo que el CONTEXTO no describe, aplica la regla 2 (di que no esta en la documentacion), aunque el tema suene parecido.
- Cada tipo, opcion, campo o paso que menciones debe aparecer LITERALMENTE en el CONTEXTO. Si no lo puedes señalar en el texto del CONTEXTO, no lo escribas.

CLARIFICACION GUIADA:
8. Si la solicitud del cliente es general o ambigua (p.ej. "quiero hacer un egreso") y el CONTEXTO describe VARIOS tipos, variantes o caminos concretos para eso, NO respondas con un procedimiento genérico. En su lugar, haz una pregunta breve para orientarlo (p.ej. "¿Qué tipo de egreso quieres hacer?") y ofrécele las opciones concretas que aparezcan en el CONTEXTO.
9. Formato de las opciones: escribe primero la pregunta breve; luego, en una línea nueva, el marcador [[OPCIONES]] y, debajo, cada opción en su propia línea empezando con "- ". Ejemplo (las opciones se toman del CONTEXTO, no del ejemplo):
   ¿Qué tipo de egreso quieres registrar?
   [[OPCIONES]]
   - Traspaso
   - Merma
10. Cada opción debe ser un término que aparezca LITERALMENTE en el CONTEXTO (copia el nombre tal cual figura, p.ej. el título de la sección o del tipo). Texto corto (1 a 6 palabras). Máximo 6 opciones. PROHIBIDO inventar, deducir o agregar opciones que no estén escritas en el CONTEXTO; PROHIBIDO agregar "Otro".
11. Usa esto SOLO cuando de verdad ayuda a desambiguar. Si la pregunta ya es específica y describe un procedimiento, responde con el paso a paso COMPLETO (regla 6) y NO incluyas el marcador [[OPCIONES]].
12. Si no hay en el CONTEXTO tipos/variantes concretos que ofrecer (o solo los sabrías por conocimiento externo), NO uses el marcador [[OPCIONES]]: aplica la regla 2.`;

// Mensaje honesto cuando no hay respuesta anclada en la documentacion. Se usa
// tanto cuando no se recupera contexto como cuando las opciones de clarificacion
// resultan no ancladas (inventadas) y se descartan.
export const NO_CONTEXT_ANSWER =
  'Esa informacion no esta en la documentacion disponible. Te sugiero contactar al equipo de soporte.';

/** Minusculas y sin tildes, para comparar texto del LLM de forma flexible. */
export function normalizeText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * true si la respuesta es el fallback honesto, aunque el LLM lo haya redactado
 * con tildes o con otra despedida ("contactar al soporte del equipo").
 */
export function isNoContextAnswer(answer) {
  return normalizeText(answer).includes('no esta en la documentacion disponible');
}

// Marcador con el que el modelo separa la pregunta de clarificacion de sus
// opciones clicables. Se define aqui para no repetir el literal.
const OPTIONS_MARKER = '[[OPCIONES]]';

/**
 * Separa la respuesta cruda del LLM en { answer, options }.
 * Si el modelo incluyo el marcador [[OPCIONES]], todo lo anterior es el texto
 * y las lineas siguientes (con guion) son las opciones clicables. Si no, se
 * devuelve el texto completo y options vacio. Robusto: nunca lanza.
 */
export function splitAnswerOptions(raw) {
  const text = String(raw == null ? '' : raw);
  const at = text.indexOf(OPTIONS_MARKER);
  if (at === -1) return { answer: text.trim(), options: [] };

  const answer = text.slice(0, at).trim();
  const options = text
    .slice(at + OPTIONS_MARKER.length)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*+]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return { answer, options };
}

// Palabras genericas/vacias que no sirven para verificar si una opcion esta
// anclada en el CONTEXTO (articulos, preposiciones y el vocabulario de dominio
// que es comun a todas las variantes). Sin ellas, lo que queda de una opcion son
// sus palabras "distintivas" (p.ej. de "Egreso por finiquito" queda "finiquito").
const OPTION_STOPWORDS = new Set([
  'egreso', 'egresos', 'ingreso', 'ingresos', 'nuevo', 'nueva', 'tipo', 'tipos',
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'por',
  'para', 'con', 'sin', 'y', 'o', 'u', 'a', 'en', 'al', 'hacer', 'registrar',
  'realizar', 'opcion', 'opciones', 'que', 'como',
]);

/** Normaliza texto para comparar: minusculas, sin acentos, solo alfanumerico. */
function normalizeForMatch(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacriticos (á -> a)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filtra las opciones de clarificacion para dejar SOLO las que estan ancladas en
 * el CONTEXTO recuperado. Es la red de seguridad programatica contra las opciones
 * inventadas por el LLM (p.ej. "Egreso por finiquito" cuando la doc solo describe
 * egresos de inventario: Traspaso, Merma, Ajuste, Devolucion).
 *
 * Una opcion se considera anclada si TODAS sus palabras distintivas (quitando
 * stopwords/vocabulario de dominio) aparecen en el texto del CONTEXTO. Si una
 * opcion no tiene ninguna palabra distintiva, se descarta por ser demasiado
 * generica para verificarla.
 */
export function filterGroundedOptions(options, chunks) {
  if (!Array.isArray(options) || !options.length) return [];
  const haystack = new Set(
    normalizeForMatch(chunks.map((c) => `${c.title} ${c.content}`).join(' ')).split(' '),
  );
  return options.filter((opt) => {
    const tokens = normalizeForMatch(opt)
      .split(' ')
      .filter((w) => w.length >= 3 && !OPTION_STOPWORDS.has(w));
    if (!tokens.length) return false;
    return tokens.every((t) => haystack.has(t));
  });
}

/** Construye el bloque de contexto a partir de los chunks recuperados. */
export function buildContext(chunks) {
  return chunks
    .map((c, i) => `--- Fragmento ${i + 1} (de "${c.title}") ---\n${c.content}`)
    .join('\n\n');
}

/** Mensaje de usuario final: contexto + (hilo previo opcional) + pregunta. */
export function buildUserMessage({ question, chunks, history }) {
  const context = buildContext(chunks);
  let convo = '';
  if (history && history.length) {
    const lines = history
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`)
      .join('\n');
    convo =
      'CONVERSACION PREVIA (para entender a que se refiere la ultima pregunta del cliente):\n' +
      lines +
      '\n\n---\n\n';
  }
  return `CONTEXTO:\n${context}\n\n---\n\n${convo}PREGUNTA DEL CLIENTE:\n${question}`;
}

/**
 * Convierte la URL del Markdown crudo (lo que se ingesta) a la URL de la pagina
 * legible de GitBook, que es la util para el usuario final.
 *   .../transbank/webpay.md  ->  .../transbank/webpay
 * En GitBook la pagina HTML es la misma ruta sin la extension ".md".
 */
export function toPageUrl(mdUrl) {
  return mdUrl.replace(/\.md(?=$|[?#])/, '');
}

/** Raices (5 letras, sin tildes) de las palabras de 5+ letras de un texto. */
function stemSet(text) {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5)
      .map((w) => w.slice(0, 5)),
  );
}

/**
 * Devuelve solo la fuente mas relevante (titulo + url).
 * Con `answer`, cita la pagina del contexto cuyo contenido comparte mas
 * vocabulario con la respuesta generada (la pagina de la que realmente salio),
 * en vez del top-1 de la busqueda, que puede ser una pagina hermana parecida
 * (p.ej. "Precios Capturados" al responder sobre "Programacion de Scrapers").
 * Empate o sin `answer` -> el primer chunk, que es el de mayor relevancia.
 */
export function collectSources(chunks, answer) {
  const top = chunks[0];
  if (!top) return [];
  let best = top;
  if (answer) {
    const answerStems = stemSet(answer);
    const pages = new Map();
    for (const c of chunks) {
      if (!pages.has(c.source_url)) pages.set(c.source_url, { chunk: c, text: '' });
      pages.get(c.source_url).text += ' ' + c.content;
    }
    let bestScore = -1;
    for (const { chunk, text } of pages.values()) {
      const pageStems = stemSet(text);
      let score = 0;
      for (const s of answerStems) if (pageStems.has(s)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = chunk;
      }
    }
  }
  return [{ title: best.title, url: toPageUrl(best.source_url) }];
}
