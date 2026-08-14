import { config } from '../config.js';
import {
  getModules,
  listConversations,
  getConversationMessages,
} from '../db.js';
import { toPageUrl } from './prompt.js';

/**
 * GET /api/modules[?index=<index_source>]
 * Devuelve los modulos de la consulta derivados de la documentacion ingestada:
 * las secciones de primer nivel de cada manual (ver getModules en db.js).
 * Con `index`, restringe la respuesta a ese manual (p.ej. el portal IMS pide
 * solo los modulos del manual "ims"). Coincidencia sin distincion de mayusculas.
 * MODULE_LABELS puede sobreescribir la etiqueta de un modulo por su id.
 */
export async function modulesHandler(req, res) {
  try {
    const index = (req.query?.index || '').toString().trim().toLowerCase();
    let mods = await getModules();
    if (index) {
      mods = mods.filter((m) => (m.index || '').toLowerCase() === index);
    }
    const modules = mods.map((m) => ({
      id: m.id,
      label: config.moduleLabels[m.id] || m.label,
    }));
    return res.json({ modules });
  } catch (err) {
    console.error('Error en /api/modules:', err.message);
    return res.status(500).json({ error: 'No se pudieron cargar los modulos.' });
  }
}

/** Extrae y valida el userId desde la query. */
function getUserId(req) {
  const userId = (req.query?.userId || '').toString().trim();
  return userId || null;
}

/**
 * GET /api/conversations?userId=...
 * Lista las conversaciones recientes del usuario.
 */
export async function listConversationsHandler(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'Falta userId.' });
    const conversations = await listConversations(userId);
    return res.json({ conversations });
  } catch (err) {
    console.error('Error en GET /api/conversations:', err.message);
    return res.status(500).json({ error: 'No se pudieron cargar las conversaciones.' });
  }
}

/**
 * GET /api/conversations/:id?userId=...
 * Devuelve los mensajes de una conversacion (validando propiedad por userId).
 */
export async function getConversationHandler(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'Falta userId.' });

    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ error: 'Id de conversacion invalido.' });
    }

    const rows = await getConversationMessages(conversationId, userId);
    if (rows === null) {
      return res.status(404).json({ error: 'Conversacion no encontrada.' });
    }

    // Normaliza las fuentes (ya vienen con URL de pagina desde el guardado, pero
    // por robustez volvemos a pasar por toPageUrl si hiciera falta).
    const messages = rows.map((m) => ({
      role: m.role,
      content: m.content,
      sources: Array.isArray(m.sources)
        ? m.sources.map((s) => ({ title: s.title, url: toPageUrl(s.url || '') }))
        : [],
      created_at: m.created_at,
    }));

    return res.json({ messages });
  } catch (err) {
    console.error('Error en GET /api/conversations/:id:', err.message);
    return res.status(500).json({ error: 'No se pudo cargar la conversacion.' });
  }
}
