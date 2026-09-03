import { config } from '../src/config.js';
import { pool } from '../src/db.js';

/**
 * Verificacion rapida del estado de la base de datos apuntada por DATABASE_URL.
 * No modifica nada: solo lee y reporta.
 */

function host(url) {
  try { return new URL(url).host; } catch { return '(no parseable)'; }
}

async function tableExists(name) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${name}`]);
  return rows[0].reg !== null;
}

async function main() {
  console.log('== Verificacion de la BD ==');
  console.log(`Host:            ${host(config.databaseUrl)}`);
  console.log(`EMBEDDING_DIM:   ${config.embeddingDim} (esperado por el .env)`);

  // 1. Conexion + version
  const { rows: v } = await pool.query('SELECT version()');
  console.log(`Conexion OK:     ${v[0].version.split(',')[0]}`);

  // 2. pgvector instalado?
  const { rows: ext } = await pool.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  console.log(`pgvector:        ${ext.length ? 'v' + ext[0].extversion : 'NO INSTALADO'}`);

  // 3. Tablas presentes
  for (const t of ['doc_chunks', 'conversations', 'messages']) {
    console.log(`Tabla ${t.padEnd(14)} ${(await tableExists(t)) ? 'existe' : 'FALTA'}`);
  }

  if (!(await tableExists('doc_chunks'))) {
    console.log('\n⚠ doc_chunks no existe: la ingesta aun no ha corrido en esta BD.');
    await pool.end();
    process.exit(1);
  }

  // 4. Dimension real de la columna embedding
  const { rows: dim } = await pool.query(`
    SELECT a.atttypmod AS dim
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = 'doc_chunks' AND a.attname = 'embedding'
  `);
  const realDim = dim.length ? dim[0].dim : null;
  const dimOk = realDim === config.embeddingDim;
  console.log(`\nDim columna embedding: ${realDim}  ${dimOk ? '✓ coincide con .env' : '✗ NO coincide con EMBEDDING_DIM'}`);

  // 5. Conteo total + por manual
  const { rows: total } = await pool.query('SELECT COUNT(*)::int AS n FROM doc_chunks');
  console.log(`\nChunks totales:  ${total[0].n}`);

  const { rows: bySrc } = await pool.query(`
    SELECT index_source,
           COUNT(*)::int              AS chunks,
           COUNT(DISTINCT source_url)::int AS paginas,
           MAX(updated_at)            AS ultima_actualizacion
      FROM doc_chunks
     GROUP BY index_source
     ORDER BY index_source
  `);
  console.log('\nPor manual (index_source):');
  for (const r of bySrc) {
    console.log(
      `  · ${r.index_source.padEnd(10)} ${String(r.paginas).padStart(3)} pag  ${String(r.chunks).padStart(4)} chunks  (act. ${new Date(r.ultima_actualizacion).toISOString().slice(0, 16).replace('T', ' ')})`,
    );
  }

  // 6. Chunks con embedding nulo (no deberia haber)
  const { rows: nulls } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM doc_chunks WHERE embedding IS NULL',
  );
  console.log(`\nEmbeddings nulos: ${nulls[0].n} ${nulls[0].n === 0 ? '✓' : '✗ hay filas sin vector'}`);

  // 7. Indices presentes
  const { rows: idx } = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'doc_chunks'
     ORDER BY indexname
  `);
  console.log('\nIndices en doc_chunks:');
  for (const r of idx) console.log(`  · ${r.indexname}`);
  const hasHnsw = idx.some((r) => r.indexname === 'doc_chunks_embedding_idx');
  console.log(`Indice vectorial HNSW: ${hasHnsw ? '✓ presente' : '✗ FALTA'}`);

  // 8. Prueba de busqueda vectorial real (vector cero -> solo valida que el operador corre)
  try {
    const zero = `[${new Array(config.embeddingDim).fill(0).join(',')}]`;
    const { rows: probe } = await pool.query(
      'SELECT title, index_source FROM doc_chunks ORDER BY embedding <=> $1::vector LIMIT 3',
      [zero],
    );
    console.log(`\nBusqueda vectorial (<=>): OK, devolvio ${probe.length} filas de muestra.`);
  } catch (e) {
    console.log(`\nBusqueda vectorial: ✗ fallo -> ${e.message}`);
  }

  console.log('\n== Fin ==');
  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFallo en la verificacion:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
