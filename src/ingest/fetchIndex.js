/**
 * Descarga un archivo llms.txt y extrae los enlaces a paginas individuales.
 * El formato es Markdown: cada linea util es "- [Titulo](URL.md)".
 * Es tolerante: ignora lineas que no sean enlaces validos.
 */

// Captura: - [Titulo](URL)   (con o sin guion/espacios iniciales)
const LINK_RE = /^\s*[-*]?\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;

export function parseLlmsIndex(markdown, baseUrl) {
  const links = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(LINK_RE);
    if (!m) continue;
    const title = m[1].trim();
    let url = m[2].trim();
    if (!title || !url) continue;
    try {
      // Resuelve URLs relativas respecto al indice.
      url = new URL(url, baseUrl).href;
    } catch {
      continue; // URL invalida -> se ignora
    }
    links.push({ title, url });
  }
  return links;
}

export async function fetchLlmsIndex(indexUrl) {
  const res = await fetch(indexUrl);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el indice ${indexUrl}: HTTP ${res.status}`);
  }
  const md = await res.text();
  return parseLlmsIndex(md, indexUrl);
}
