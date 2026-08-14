import 'dotenv/config';

/**
 * Carga y valida la configuracion desde variables de entorno.
 * Falla temprano y con mensajes claros si falta algo esencial.
 */

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`La variable ${name} debe ser un entero (recibido: "${raw}")`);
  }
  return n;
}

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const embeddingProvider = optional('EMBEDDING_PROVIDER', '') || optional('AI_PROVIDER', 'gemini');

/**
 * Parsea MODULE_LABELS ("dps-pos:Punto de Venta,otra:Otra") a un objeto
 * { 'dps-pos': 'Punto de Venta', ... }. Sirve para el texto visible del selector
 * de modulo. Los index_source sin etiqueta usan un "prettify" del slug.
 */
function mapEnv(name) {
  const raw = process.env[name];
  const out = {};
  if (!raw || !raw.trim()) return out;
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),

  // Proveedor de IA
  aiProvider: optional('AI_PROVIDER', 'gemini').toLowerCase(),
  embeddingProvider: embeddingProvider.toLowerCase(),
  embeddingDim: intEnv('EMBEDDING_DIM', 768),

  gemini: {
    apiKey: optional('GEMINI_API_KEY', ''),
    chatModel: optional('GEMINI_CHAT_MODEL', 'gemini-flash-latest'),
    embedModel: optional('GEMINI_EMBED_MODEL', 'gemini-embedding-001'),
  },
  claude: {
    apiKey: optional('ANTHROPIC_API_KEY', ''),
    chatModel: optional('CLAUDE_CHAT_MODEL', 'claude-3-5-haiku-latest'),
  },
  openai: {
    apiKey: optional('OPENAI_API_KEY', ''),
    chatModel: optional('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
    embedModel: optional('OPENAI_EMBED_MODEL', 'text-embedding-3-small'),
  },

  // Ingesta
  llmsIndexes: listEnv('LLMS_INDEXES', ['https://docs.itam.app/dps-pos/llms.txt']),
  fetchDelayMs: intEnv('FETCH_DELAY_MS', 300),
  chunkSize: intEnv('CHUNK_SIZE', 1000),
  chunkOverlap: intEnv('CHUNK_OVERLAP', 150),

  // Etiquetas legibles para el selector de modulo (index_source -> label).
  moduleLabels: mapEnv('MODULE_LABELS'),

  // Servidor
  port: intEnv('PORT', 3000),
  ragTopN: intEnv('RAG_TOP_N', 5),
  corsAllowedOrigins: listEnv('CORS_ALLOWED_ORIGINS', []),
  rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 20),
};

/** Valida que exista la API key del proveedor que se vaya a usar. */
export function assertProviderKeys({ forIngest = false } = {}) {
  const needed = new Set([config.aiProvider, config.embeddingProvider]);
  // En ingesta solo se necesitan embeddings; en el server, ambos.
  const providersToCheck = forIngest ? [config.embeddingProvider] : [...needed];

  for (const p of providersToCheck) {
    if (p === 'gemini' && !config.gemini.apiKey) {
      throw new Error('Falta GEMINI_API_KEY (proveedor gemini activo).');
    }
    if (p === 'claude' && !config.claude.apiKey) {
      throw new Error('Falta ANTHROPIC_API_KEY (proveedor claude activo).');
    }
    if (p === 'openai' && !config.openai.apiKey) {
      throw new Error('Falta OPENAI_API_KEY (proveedor openai activo).');
    }
  }
}
