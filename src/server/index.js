import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertProviderKeys } from '../config.js';
import { pool } from '../db.js';
import { corsMiddleware } from './middleware/cors.js';
import { chatRateLimiter } from './middleware/rateLimit.js';
import { chatHandler } from './chat.js';

// Falla temprano si faltan API keys del proveedor activo (chat + embeddings).
assertProviderKeys();

const app = express();
app.disable('x-powered-by');

// Necesario para que el rate-limit lea la IP real detras de un proxy (Render, etc.)
app.set('trust proxy', 1);

app.use(express.json({ limit: '32kb' }));
app.use(corsMiddleware());

// Sirve el widget autocontenido (public/widget.js). La carga de un <script>
// no esta sujeta a CORS, por lo que queda disponible para cualquier portal.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(__dirname, '../../public')));

// Pagina de prueba local: sirvela desde el server para que el Origin sea valido
// para CORS (recuerda anadir http://localhost:PORT a CORS_ALLOWED_ORIGINS).
app.get('/test.html', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../test.html'));
});

// Health check simple.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', provider: config.aiProvider });
  } catch {
    res.status(500).json({ status: 'db_error' });
  }
});

// Endpoint publico del chat, con rate limiting por IP.
app.post('/api/chat', chatRateLimiter(), chatHandler);

// Manejo de errores de CORS y otros.
app.use((err, req, res, next) => {
  if (err?.message?.startsWith('Origen no permitido')) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  console.error('Error no controlado:', err?.message);
  return res.status(500).json({ error: 'Error interno.' });
});

const server = app.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
  console.log(`Proveedor de IA: ${config.aiProvider} | embeddings: ${config.embeddingProvider}`);
  console.log(`Origenes CORS permitidos: ${config.corsAllowedOrigins.join(', ') || '(ninguno)'}`);
});

// Cierre limpio.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} recibido, cerrando...`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
