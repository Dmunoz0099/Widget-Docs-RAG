import { config } from '../config.js';
import {
  searchSimilar,
  createConversation,
  appendMessage,
  touchConversation,
  conversationBelongsTo,
  getDistinctModules,
} from '../db.js';
import { getChatProvider, getEmbeddingProvider } from '../providers/index.js';
import { SYSTEM_PROMPT, buildUserMessage, collectSources } from './prompt.js';

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

    let conversationId = req.body?.conversationId;
    conversationId = Number.isInteger(conversationId) ? conversationId : null;

    // Si viene conversationId, valida que sea del usuario; si no, se ignora.
    if (conversationId && !(await conversationBelongsTo(conversationId, userId))) {
      conversationId = null;
    }

    // El modulo puede ser: (a) una seccion de un manual (id = prefijo URL)
    // -> filtro por prefijo; (b) un manual completo (id = index_source)
    // -> filtro por index_source; (c) un modulo no ingestado (p.ej. funcional
    // del portal) -> pista semantica que enriquece la consulta sin filtrar.
    let filter = null;
    let queryText = question;
    if (moduleId) {
      if (/^https?:\/\//i.test(moduleId)) {
        filter = { sectionPrefix: moduleId };
      } else {
        const known = await getKnownModules();
        if (known.has(moduleId)) filter = { indexSource: moduleId };
        else queryText = `[Módulo: ${moduleLabel || moduleId}] ${question}`;
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

    // Sin contexto recuperado -> no llamamos al LLM; respondemos la regla critica.
    let answer;
    let sources = [];
    if (!chunks.length) {
      answer =
        'Esa informacion no esta en la documentacion disponible. Te sugiero contactar al equipo de soporte.';
    } else {
      const userMessage = buildUserMessage({ question, chunks });
      const chat = getChatProvider();
      answer = await chat.generate({ system: SYSTEM_PROMPT, user: userMessage });
      sources = collectSources(chunks);
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

    return res.json({ answer, sources, conversationId });
  } catch (err) {
    console.error('Error en /api/chat:', err.message);
    return res.status(500).json({
      error: 'Ocurrio un error procesando tu pregunta. Intenta de nuevo mas tarde.',
    });
  }
}
