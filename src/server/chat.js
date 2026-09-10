import { config } from '../config.js';
import {
  searchSimilar,
  createConversation,
  appendMessage,
  touchConversation,
  conversationBelongsTo,
  getConversationMessages,
  getPageChunks,
  getDistinctModules,
} from '../db.js';
import { getChatProvider, getEmbeddingProvider } from '../providers/index.js';
import { isBoilerplate } from '../ingest/chunk.js';
import { SYSTEM_PROMPT, buildUserMessage, collectSources, splitAnswerOptions } from './prompt.js';

// Cuantas paginas distintas de los resultados se expanden a pagina completa.
const EXPAND_PAGES = 3;

// Cache en memoria de los index_source conocidos (manuales ingestados).
// Sirve para decidir si el "modulo" seleccionado es un filtro real de BD o solo
// una pista semantica (p.ej. modulos funcionales del portal como "Administracion").
let knownModulesCache = null;
let knownModulesAt = 0;
const KNOWN_TTL_MS = 5 * 60 * 1000;
async function getKnownModules() {
  const now = Date.now();
  if (!knownModulesCache || now - knownModulesAt > KNOWN_TTL_MS) {
    knownModulesCache = new Set(await getDistinctModules());
    knownModulesAt = now;
  }
  return knownModulesCache;
}

// NOTA DE SEGURIDAD: userId lo envia el cliente (lo inyecta el portal en el
// widget) y NO esta autenticado por el backend. Es aceptable para portales
// internos de confianza. Para reforzar en el futuro: firmar {userId} con HMAC
// en el portal y verificar la firma aqui antes de asociar la conversacion.

/** Deriva un titulo corto para la conversacion a partir de la primera pregunta. */
function deriveTitle(question) {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '...' : clean;
}

/**
 * Handler de POST /api/chat.
 * 1. valida la pregunta
 * 2. genera su embedding
 * 3. recupera los N chunks mas relevantes (filtrados por modulo si se indico)
 * 4. arma el prompt con ese contexto y llama al LLM
 * 5. persiste la conversacion (user + bot) y devuelve conversationId
 */
export async function chatHandler(req, res) {
  try {
    const question = (req.body?.question || '').toString().trim();
    if (!question) {
      return res.status(400).json({ error: 'Falta el campo "question".' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: 'La pregunta es demasiado larga.' });
    }

    // moduleId = clave de filtro (prefijo de seccion o index_source);
    // moduleLabel = etiqueta visible. Compatibilidad: si solo llega `module`,
    // se usa como id y etiqueta.
    const moduleId = (req.body?.moduleId || req.body?.module || '').toString().trim() || null;
    const moduleLabel = (req.body?.moduleLabel || req.body?.module || '').toString().trim() || null;
    // Manual al que pertenece el portal (index_source). Si viene, acota la
    // busqueda a ese manual aunque no se haya elegido una seccion concreta.
    const manualIndex = (req.body?.manualIndex || '').toString().trim() || null;
    const userId = (req.body?.userId || '').toString().trim() || 'anon';
    const userName = (req.body?.userName || '').toString().trim() || null;
    const origin = req.headers.origin || null;

    // conversationId puede llegar como number o como string (pg devuelve los
    // BIGINT como string, y el widget lo reenvia tal cual). Se coacciona a entero.
    let conversationId = req.body?.conversationId;
    conversationId = conversationId == null ? null : Number.parseInt(conversationId, 10);
    if (!Number.isInteger(conversationId)) conversationId = null;

    // Si viene conversationId, valida que sea del usuario; si no, se ignora.
    if (conversationId && !(await conversationBelongsTo(conversationId, userId))) {
      conversationId = null;
    }

    // Hilo previo de la conversacion (turnos ya guardados; el mensaje actual aun
    // no se persiste). Sirve para: (a) enriquecer la query de recuperacion —un
    // clic en una opcion como "Factura (FAC)" no tiene sentido aislado— y (b) dar
    // contexto al LLM para que entienda a que se refiere la pregunta corta.
    let history = [];
    if (conversationId) {
      history = (await getConversationMessages(conversationId, userId)) || [];
    }

    // El modulo puede ser: (a) una seccion de un manual (id = prefijo URL)
    // -> filtro por prefijo; (b) un manual completo (id = index_source)
    // -> filtro por index_source; (c) un modulo no ingestado (p.ej. funcional
    // del portal) -> pista semantica que enriquece la consulta sin filtrar.
    let filter = null;
    // Query de recuperacion: combina las ultimas preguntas del usuario con la
    // actual para no perder el hilo (pedido -> Compra Directa -> Factura).
    let queryText = question;
    const priorUser = history
      .filter((m) => m.role === 'user')
      .map((m) => (m.content || '').trim())
      .filter(Boolean)
      .slice(-3);
    if (priorUser.length) queryText = priorUser.join(' ') + ' ' + question;

    if (moduleId) {
      if (/^https?:\/\//i.test(moduleId)) {
        filter = { sectionPrefix: moduleId };
      } else {
        const known = await getKnownModules();
        if (known.has(moduleId)) filter = { indexSource: moduleId };
        else queryText = `[Módulo: ${moduleLabel || moduleId}] ${queryText}`;
      }
    }
    // Sin seccion concreta pero con manual del portal -> acota al manual.
    if (!filter && manualIndex) filter = { indexSource: manualIndex };

    const embedder = getEmbeddingProvider();
    const [queryEmbedding] = await embedder.embed([queryText]);

    let chunks = await searchSimilar(queryEmbedding, config.ragTopN, filter);
    // Red de seguridad: si el filtro de seccion no devuelve nada, reintenta sin
    // filtro para no dejar al usuario sin respuesta.
    if (filter && !chunks.length) {
      chunks = await searchSimilar(queryEmbedding, config.ragTopN, null);
    }

    // Descarta el boilerplate de GitBook que sigue en la BD de ingestas previas
    // (Agent Instructions, "Querying This Documentation", cabecera llms.txt).
    chunks = chunks.filter((c) => !isBoilerplate(c.content));

    // Reconstruye el paso a paso completo. El troceado (~CHUNK_SIZE) parte un
    // procedimiento en varios chunks y top-N no siempre los trae todos. Ademas,
    // el detalle suele vivir en su propia pagina (p.ej. "Merma"), que no siempre
    // es el top-1 (una pagina resumen como "Nuevo Egreso" puede ganar). Por eso
    // expandimos a pagina COMPLETA las primeras EXPAND_PAGES paginas distintas
    // que aparezcan en los resultados, en orden de relevancia.
    if (chunks.length) {
      const orderedUrls = [];
      const seen = new Set();
      for (const c of chunks) {
        if (!seen.has(c.source_url)) {
          seen.add(c.source_url);
          orderedUrls.push(c.source_url);
        }
      }
      const pagesToExpand = orderedUrls.slice(0, EXPAND_PAGES);
      const expanded = [];
      for (const url of pagesToExpand) {
        const pageChunks = (await getPageChunks(url)).filter((c) => !isBoilerplate(c.content));
        expanded.push(...pageChunks);
      }
      // Chunks relevantes de paginas fuera del tope: se conservan como apoyo.
      const others = chunks.filter((c) => !pagesToExpand.includes(c.source_url));
      chunks = [...expanded, ...others];
    }

    // Sin contexto recuperado -> no llamamos al LLM; respondemos la regla critica.
    let answer;
    let sources = [];
    // Opciones de clarificacion clicables (p.ej. tipos de egreso). Se derivan del
    // marcador [[OPCIONES]] que el LLM agrega cuando la pregunta es general.
    let options = [];
    if (!chunks.length) {
      answer =
        'Esa informacion no esta en la documentacion disponible. Te sugiero contactar al equipo de soporte.';
    } else {
      // Ultimos turnos (recortados) para que el LLM entienda referencias como
      // "Factura (FAC)" sin arrastrar toda la conversacion.
      const recentHistory = history.slice(-4).map((m) => ({
        role: m.role,
        content: (m.content || '').slice(0, 500),
      }));
      const userMessage = buildUserMessage({ question, chunks, history: recentHistory });
      const chat = getChatProvider();
      const raw = await chat.generate({ system: SYSTEM_PROMPT, user: userMessage });
      ({ answer, options } = splitAnswerOptions(raw));
      // En una pregunta de clarificacion las fuentes distraen; se muestran solo
      // cuando el bot da una respuesta de contenido real.
      sources = options.length ? [] : collectSources(chunks);
    }

    // Persiste la conversacion. Crea una nueva si no habia conversationId valido.
    if (!conversationId) {
      conversationId = await createConversation({
        userId,
        userName,
        origin,
        module: moduleId,
        moduleLabel,
        title: deriveTitle(question),
      });
    }
    await appendMessage({ conversationId, role: 'user', content: question });
    await appendMessage({ conversationId, role: 'bot', content: answer, sources });
    await touchConversation(conversationId);

    // Devuelve conversationId como number (createConversation lo trae como
    // string desde pg) para que el round-trip con el widget sea consistente.
    // `options` (si las hay) son botones de clarificacion que pinta el widget.
    return res.json({ answer, sources, options, conversationId: Number(conversationId) });
  } catch (err) {
    console.error('Error en /api/chat:', err.message);
    return res.status(500).json({
      error: 'Ocurrio un error procesando tu pregunta. Intenta de nuevo mas tarde.',
    });
  }
}
