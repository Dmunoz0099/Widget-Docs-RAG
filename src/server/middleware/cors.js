import cors from 'cors';
import { config } from '../../config.js';

/**
 * CORS con lista blanca desde env. NUNCA "*".
 * - Permite requests sin Origin (curl, health checks, same-origin).
 * - Rechaza cualquier origen que no este en CORS_ALLOWED_ORIGINS.
 */
export function corsMiddleware() {
  const allowed = new Set(config.corsAllowedOrigins);

  return cors({
    origin(origin, callback) {
      // Sin Origin (peticiones no-navegador) -> permitir.
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  });
}
