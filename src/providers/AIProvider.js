/**
 * Contrato comun para todos los proveedores de IA.
 * El resto del sistema (ingesta y backend) depende SOLO de esta interfaz,
 * nunca de una implementacion concreta. Cambiar de proveedor se hace por env.
 *
 * Todo proveedor debe implementar:
 *   - embed(texts: string[]): Promise<number[][]>   // un vector por texto
 *   - generate({ system, user }): Promise<string>   // respuesta de chat
 */
export class AIProvider {
  // eslint-disable-next-line no-unused-vars
  async embed(texts) {
    throw new Error('embed() no implementado');
  }

  // eslint-disable-next-line no-unused-vars
  async generate({ system, user }) {
    throw new Error('generate() no implementado');
  }
}

/** Helper: fetch con timeout y error legible. */
export async function httpJson(url, options = {}, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const msg = body?.error?.message || body?.error || res.statusText;
      throw new Error(`HTTP ${res.status} en ${url}: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}
