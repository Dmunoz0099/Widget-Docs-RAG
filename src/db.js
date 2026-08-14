import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Supabase requiere SSL. rejectUnauthorized:false evita problemas de cadena de
// certificados en local sin bajar la seguridad del cifrado en transito.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

/** Serializa un array JS a literal de pgvector: [0.1,0.2,...] */
export function toVectorLiteral(arr) {
  return `[${arr.join(',')}]`;
}

/**
 * Crea la extension pgvector, la tabla y los indices si no existen.
 * La dimension del vector viene de EMBEDDING_DIM (validada como entero).
 */
export async function initSchema() {
  const dim = config.embeddingDim;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`EMBEDDING_DIM invalido: ${dim}`);
  }

  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_chunks (
        id            BIGSERIAL PRIMARY KEY,
        index_source  TEXT        NOT NULL,
        title         TEXT        NOT NULL,
        source_url    TEXT        NOT NULL,
        chunk_index   INT         NOT NULL,
        content       TEXT        NOT NULL,
        content_hash  TEXT        NOT NULL,
        embedding     VECTOR(${dim}) NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source_url, chunk_index)
      )
    `);

    // HNSW en vez de ivfflat: alto recall sin tener que tunear "probes", y se
    // comporta bien tanto con pocos cientos de vectores como al crecer el corpus.
    // (ivfflat con lists altas sobre pocas filas hunde el recall: solo escanea
    //  una fraccion de las listas con probes=1.)
    await client.query(`
      CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
        ON doc_chunks USING hnsw (embedding vector_cosine_ops)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS doc_chunks_index_source_idx
        ON doc_chunks (index_source)
    `);
  } finally {
    client.release();
  }
}

/**
 * Crea las tablas del historial de chat (conversations + messages) si no existen.
 * Va aparte de initSchema() porque el server no necesita pgvector para arrancar,
 * y la ingesta no necesita las tablas de chat. Se invoca al iniciar el server.
 */
export async function ensureChatSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT        NOT NULL,
        user_name    TEXT,
        origin       TEXT,
        module       TEXT,        -- clave de filtro (prefijo de seccion o index_source)
        module_label TEXT,        -- etiqueta visible del modulo (titulo de la seccion)
        title        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Para tablas creadas por una version anterior sin module_label.
    await client.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS module_label TEXT',
    );
    await client.query(`
      CREATE INDEX IF NOT EXISTS conversations_user_idx
        ON conversations (user_id, updated_at DESC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id              BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT        NOT NULL,
        content         TEXT        NOT NULL,
        sources         JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS messages_conversation_idx
        ON messages (conversation_id, created_at)
    `);
  } finally {
    client.release();
  }
}

/** Lista los valores distintos de index_source (un manual completo cada uno). */
export async function getDistinctModules() {
  const { rows } = await pool.query(
    'SELECT DISTINCT index_source FROM doc_chunks ORDER BY index_source',
  );
  return rows.map((r) => r.index_source);
}

/** Convierte un slug ("instalacion-de-pos") en texto legible ("Instalacion De Pos"). */
function prettify(slug) {
  return String(slug)
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Deriva los "modulos" de cada manual a partir de las URLs ingestadas: las
 * secciones de primer nivel (el primer segmento de ruta donde las paginas
 * divergen). La etiqueta es el titulo de la pagina cabecera de esa seccion.
 *
 * Ej. para DPS POS (.../dps-pos/dps-pos/ventas/boleta.md) el modulo es "Ventas"
 * y su prefijo de filtro ".../dps-pos/dps-pos/ventas".
 *
 * Devuelve [{ id: <prefijoURL>, label: <titulo>, index: <index_source> }] en el
 * orden en que aparecen en la documentacion.
 */
export async function getModules() {
  const { rows } = await pool.query(
    `SELECT source_url, title, index_source, MIN(id) AS ord
       FROM doc_chunks
      GROUP BY source_url, title, index_source
      ORDER BY ord`,
  );

  // Agrupa las paginas por manual (index_source), preservando el orden.
  const byIndex = new Map();
  for (const r of rows) {
    if (!byIndex.has(r.index_source)) byIndex.set(r.index_source, []);
    let pathname;
    try {
      pathname = new URL(r.source_url).pathname;
    } catch {
      continue;
    }
    const segs = pathname.replace(/\.md$/i, '').split('/').filter(Boolean);
    byIndex.get(r.index_source).push({ url: r.source_url, title: r.title, segs });
  }

  const modules = [];
  for (const [index, pages] of byIndex) {
    if (!pages.length) continue;
    // Profundidad del prefijo comun a todas las paginas del manual.
    const minLen = Math.min(...pages.map((p) => p.segs.length));
    let depth = 0;
    while (depth < minLen - 1) {
      const seg = pages[0].segs[depth];
      if (pages.every((p) => p.segs[depth] === seg)) depth++;
      else break;
    }

    // Agrupa por el segmento en `depth` = seccion de primer nivel.
    const groups = new Map();
    for (const p of pages) {
      const slug = p.segs[depth];
      if (slug === undefined) continue;
      if (!groups.has(slug)) groups.set(slug, []);
      groups.get(slug).push(p);
    }

    const origin = (() => {
      try { return new URL(pages[0].url).origin; } catch { return ''; }
    })();

    for (const [slug, groupPages] of groups) {
      const prefixSegs = groupPages[0].segs.slice(0, depth).concat(slug);
      const prefixUrl = origin + '/' + prefixSegs.join('/');
      // Etiqueta = titulo de la pagina cabecera (la que termina justo en el slug).
      const head = groupPages.find((p) => p.segs.length === depth + 1);
      const label = head ? head.title : prettify(slug);
      modules.push({ id: prefixUrl, label, index });
    }
  }
  return modules;
}

/** Crea una conversacion y devuelve su id. */
export async function createConversation({ userId, userName, origin, module, moduleLabel, title }) {
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, user_name, origin, module, module_label, title)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, userName || null, origin || null, module || null, moduleLabel || null, title || null],
  );
  return rows[0].id;
}

/** Anade un mensaje ('user' | 'bot') a una conversacion. */
export async function appendMessage({ conversationId, role, content, sources }) {
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, sources)
     VALUES ($1, $2, $3, $4)`,
    [conversationId, role, content, sources ? JSON.stringify(sources) : null],
  );
}

/** Marca la conversacion como actualizada (para ordenarla arriba en la lista). */
export async function touchConversation(conversationId) {
  await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [
    conversationId,
  ]);
}

/** Devuelve true si la conversacion pertenece al usuario indicado. */
export async function conversationBelongsTo(conversationId, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2',
    [conversationId, userId],
  );
  return rows.length > 0;
}

/** Lista las conversaciones recientes de un usuario, con nº de mensajes. */
export async function listConversations(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.module, c.module_label, c.created_at, c.updated_at,
            COUNT(m.id)::int AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * Devuelve los mensajes de una conversacion, validando que sea del usuario.
 * Si no pertenece al usuario (o no existe), devuelve null.
 */
export async function getConversationMessages(conversationId, userId) {
  const owns = await conversationBelongsTo(conversationId, userId);
  if (!owns) return null;
  const { rows } = await pool.query(
    `SELECT role, content, sources, created_at
       FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [conversationId],
  );
  return rows;
}

/**
 * Devuelve un mapa {chunk_index -> content_hash} de los chunks ya guardados
 * para una URL de origen. Permite saltar embeddings de chunks sin cambios.
 */
export async function getExistingHashes(sourceUrl) {
  const { rows } = await pool.query(
    'SELECT chunk_index, content_hash FROM doc_chunks WHERE source_url = $1',
    [sourceUrl],
  );
  const map = new Map();
  for (const r of rows) map.set(r.chunk_index, r.content_hash);
  return map;
}

/** Inserta o actualiza un chunk (idempotente por source_url + chunk_index). */
export async function upsertChunk(chunk, embedding) {
  await pool.query(
    `INSERT INTO doc_chunks
       (index_source, title, source_url, chunk_index, content, content_hash, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector, now())
     ON CONFLICT (source_url, chunk_index) DO UPDATE SET
       index_source = EXCLUDED.index_source,
       title        = EXCLUDED.title,
       content      = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       embedding    = EXCLUDED.embedding,
       updated_at   = now()`,
    [
      chunk.indexSource,
      chunk.title,
      chunk.sourceUrl,
      chunk.chunkIndex,
      chunk.content,
      chunk.contentHash,
      toVectorLiteral(embedding),
    ],
  );
}

/**
 * Borra chunks obsoletos de una pagina cuando ahora tiene MENOS chunks que antes
 * (p.ej. la doc se acorto). Mantiene la tabla consistente en re-ejecuciones.
 */
export async function deleteStaleChunks(sourceUrl, keepCount) {
  await pool.query(
    'DELETE FROM doc_chunks WHERE source_url = $1 AND chunk_index >= $2',
    [sourceUrl, keepCount],
  );
}

/**
 * Recupera los N chunks mas similares al embedding de la pregunta.
 * `filter` (opcional) acota la busqueda:
 *   { sectionPrefix }  -> una seccion de un manual (por prefijo de URL)
 *   { indexSource }    -> un manual completo
 */
export async function searchSimilar(embedding, topN, filter) {
  const vec = toVectorLiteral(embedding);
  const params = [vec, topN];
  let where = '';
  if (filter && filter.sectionPrefix) {
    params.push(filter.sectionPrefix);
    where = `WHERE (source_url = $3 || '.md' OR source_url LIKE $3 || '/%')`;
  } else if (filter && filter.indexSource) {
    params.push(filter.indexSource);
    where = 'WHERE index_source = $3';
  }
  const { rows } = await pool.query(
    `SELECT title, source_url, index_source, content,
            1 - (embedding <=> $1::vector) AS score
       FROM doc_chunks
       ${where}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
    params,
  );
  return rows;
}
