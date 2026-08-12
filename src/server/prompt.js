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
6. No incluyas URLs en el cuerpo de la respuesta; las fuentes se muestran aparte.`;

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
