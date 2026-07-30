import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';

/** Rate limiting basico por IP para el endpoint publico. */
export function chatRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Demasiadas solicitudes. Intenta de nuevo en unos momentos.',
    },
  });
}
