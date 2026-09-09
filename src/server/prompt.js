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
5. Se claro y conciso. Usa pasos o listas cuando ayuden.
6. No incluyas URLs en el cuerpo de la respuesta; las fuentes se muestran aparte.

CLARIFICACION GUIADA:
7. Si la solicitud del cliente es general o ambigua (p.ej. "quiero hacer un egreso") y el CONTEXTO describe VARIOS tipos, variantes o caminos concretos para eso, NO respondas con un procedimiento genErico. En su lugar, haz una pregunta breve para orientarlo (p.ej. "¿QuE tipo de egreso quieres hacer?") y ofrEcele las opciones concretas que aparezcan en el CONTEXTO.
8. Formato de las opciones: escribe primero la pregunta breve; luego, en una linea nueva, el marcador [[OPCIONES]] y, debajo, cada opcion en su propia linea empezando con "- ". Ejemplo:
   ¿QuE tipo de egreso quieres registrar?
   [[OPCIONES]]
   - Egreso por finiquito
   - Egreso por renuncia
9. Cada opcion debe ser un texto corto (2 a 6 palabras) que el cliente pueda pulsar como su siguiente pregunta. MAximo 6 opciones. Usa solo las que aparezcan en el CONTEXTO; no inventes ni agregues "Otro".
10. Usa esto SOLO cuando de verdad ayuda a desambiguar. Si la pregunta ya es especIfica, responde normal y NO incluyas el marcador [[OPCIONES]].`;

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

/** Construye el bloque de contexto a partir de los chunks recuperados. */
export function buildContext(chunks) {
  return chunks
    .map((c, i) => `--- Fragmento ${i + 1} (de "${c.title}") ---\n${c.content}`)
    .join('\n\n');
}

/** Mensaje de usuario final: contexto + pregunta. */
export function buildUserMessage({ question, chunks }) {
  const context = buildContext(chunks);
  return `CONTEXTO:\n${context}\n\n---\n\nPREGUNTA DEL CLIENTE:\n${question}`;
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

/**
 * Devuelve solo la fuente mas relevante (titulo + url).
 * Los chunks llegan ordenados por similitud, asi que el primero es el mejor.
 */
export function collectSources(chunks) {
  const top = chunks[0];
  if (!top) return [];
  return [{ title: top.title, url: toPageUrl(top.source_url) }];
}
