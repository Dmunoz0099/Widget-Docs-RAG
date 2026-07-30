import { config } from '../config.js';
import { searchSimilar } from '../db.js';
import { getChatProvider, getEmbeddingProvider } from '../providers/index.js';
import { SYSTEM_PROMPT, buildUserMessage, collectSources } from './prompt.js';

/**
 * Handler de POST /api/chat.
 * 1. valida la pregunta
 * 2. genera su embedding
 * 3. recupera los N chunks mas relevantes de pgvector
 * 4. arma el prompt con ese contexto y llama al LLM
 * 5. devuelve respuesta + fuentes (titulo + URL)
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

    const embedder = getEmbeddingProvider();
    const [queryEmbedding] = await embedder.embed([question]);

    const chunks = await searchSimilar(queryEmbedding, config.ragTopN);

    // Sin contexto recuperado -> no llamamos al LLM; respondemos la regla critica.
    if (!chunks.length) {
      return res.json({
        answer:
          'Esa informacion no esta en la documentacion disponible. Te sugiero contactar al equipo de soporte.',
        sources: [],
      });
    }

    const userMessage = buildUserMessage({ question, chunks });
    const chat = getChatProvider();
    const answer = await chat.generate({ system: SYSTEM_PROMPT, user: userMessage });

    return res.json({
      answer,
      sources: collectSources(chunks),
    });
  } catch (err) {
    console.error('Error en /api/chat:', err.message);
    return res.status(500).json({
      error: 'Ocurrio un error procesando tu pregunta. Intenta de nuevo mas tarde.',
    });
  }
}
