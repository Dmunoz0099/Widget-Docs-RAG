import { config, assertProviderKeys } from '../config.js';
import { initSchema, getExistingHashes, upsertChunk, deleteStaleChunks, pool } from '../db.js';
import { getEmbeddingProvider } from '../providers/index.js';
import { fetchLlmsIndex } from './fetchIndex.js';
import { fetchPage, sleep } from './fetchPage.js';
import { chunkPage } from './chunk.js';

/**
 * Orquestador de la ingesta. Para CADA indice de LLMS_INDEXES:
 *   1. descarga el llms.txt
 *   2. parsea titulo + URL de cada linea (tolerante)
 *   3. descarga el Markdown de cada URL (con delay)
 *   4. chunkea conservando titulo + URL + index_source
 *   5. embeddea y hace upsert en pgvector
 * Es re-ejecutable e idempotente: no duplica; actualiza; borra chunks obsoletos.
 */

// Deriva un nombre de producto/seccion legible desde la URL del indice.
function deriveIndexSource(indexUrl) {
  try {
    const u = new URL(indexUrl);
    const segs = u.pathname.split('/').filter(Boolean);
    // .../dps-pos/llms.txt -> "dps-pos"
    const meaningful = segs.filter((s) => s !== 'llms.txt');
    return meaningful.length ? meaningful.join('/') : u.hostname;
  } catch {
    return indexUrl;
  }
}

async function embedChunks(provider, chunks) {
  // Embeddea en lotes para no exceder limites del proveedor.
  const BATCH = 50;
  const vectors = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vecs = await provider.embed(batch.map((c) => c.content));
    vectors.push(...vecs);
  }
  return vectors;
}

async function ingestPage({ page, indexSource, provider, stats }) {
  const markdown = await fetchPage(page.url);
  const chunks = chunkPage({
    markdown,
    title: page.title,
    sourceUrl: page.url,
    indexSource,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });

  if (chunks.length === 0) {
    console.log(`   · sin contenido: ${page.url}`);
    return;
  }

  const existing = await getExistingHashes(page.url);

  // Solo re-embeddea los chunks nuevos o modificados.
  const changed = chunks.filter((c) => existing.get(c.chunkIndex) !== c.contentHash);
  const skipped = chunks.length - changed.length;

  if (changed.length > 0) {
    const vectors = await embedChunks(provider, changed);
    for (let i = 0; i < changed.length; i++) {
      await upsertChunk(changed[i], vectors[i]);
    }
  }

  // Borra chunks que ya no existen (la pagina se acorto).
  await deleteStaleChunks(page.url, chunks.length);

  stats.pages += 1;
  stats.upserted += changed.length;
  stats.skipped += skipped;
  console.log(
    `   ✓ ${page.title}  (${changed.length} actualizados, ${skipped} sin cambios)`,
  );
}

async function main() {
  console.log('== Ingesta Widget Docs RAG ==');
  assertProviderKeys({ forIngest: true });

  console.log(`Proveedor de embeddings: ${config.embeddingProvider} (dim ${config.embeddingDim})`);
  console.log(`Indices a procesar: ${config.llmsIndexes.length}`);

  await initSchema();
  const provider = getEmbeddingProvider();
  const stats = { indexes: 0, pages: 0, upserted: 0, skipped: 0, errors: 0 };

  for (const indexUrl of config.llmsIndexes) {
    const indexSource = deriveIndexSource(indexUrl);
    console.log(`\n▶ Indice: ${indexUrl}  (source: ${indexSource})`);
    let pages;
    try {
      pages = await fetchLlmsIndex(indexUrl);
    } catch (e) {
      console.error(`  ✗ Error leyendo el indice: ${e.message}`);
      stats.errors += 1;
      continue;
    }
    console.log(`  ${pages.length} paginas encontradas`);
    stats.indexes += 1;

    for (const page of pages) {
      try {
        await ingestPage({ page, indexSource, provider, stats });
      } catch (e) {
        console.error(`   ✗ ${page.url}: ${e.message}`);
        stats.errors += 1;
      }
      await sleep(config.fetchDelayMs);
    }
  }

  console.log('\n== Resumen ==');
  console.log(`Indices:   ${stats.indexes}`);
  console.log(`Paginas:   ${stats.pages}`);
  console.log(`Upserts:   ${stats.upserted}`);
  console.log(`Sin cambio:${stats.skipped}`);
  console.log(`Errores:   ${stats.errors}`);

  await pool.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nFallo fatal en la ingesta:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
