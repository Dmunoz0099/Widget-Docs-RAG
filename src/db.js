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

    await client.query(`
      CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
        ON doc_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
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

/** Recupera los N chunks mas similares al embedding de la pregunta. */
export async function searchSimilar(embedding, topN) {
  const { rows } = await pool.query(
    `SELECT title, source_url, index_source, content,
            1 - (embedding <=> $1::vector) AS score
       FROM doc_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
    [toVectorLiteral(embedding), topN],
  );
  return rows;
}
