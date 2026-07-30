import crypto from 'node:crypto';

/**
 * Chunking por headings + tamano:
 *   1. Divide el Markdown en secciones por encabezados (#, ##, ###...).
 *   2. Cada seccion se corta en ventanas de ~CHUNK_SIZE caracteres con solape,
 *      respetando limites de parrafo cuando es posible.
 * Cada chunk conserva el titulo de pagina y su URL de origen.
 */

const HEADING_RE = /^#{1,6}\s+.*/gm;

function splitByHeadings(markdown) {
  const sections = [];
  const matches = [...markdown.matchAll(HEADING_RE)];

  if (matches.length === 0) {
    return [markdown];
  }

  // Texto anterior al primer heading (si lo hay).
  if (matches[0].index > 0) {
    const pre = markdown.slice(0, matches[0].index).trim();
    if (pre) sections.push(pre);
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    const section = markdown.slice(start, end).trim();
    if (section) sections.push(section);
  }
  return sections;
}

/** Corta un texto largo en ventanas por tamano con solape, en fronteras suaves. */
function windowize(text, size, overlap) {
  if (text.length <= size) return [text];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      // Busca un corte natural (salto de parrafo, luego de linea, luego espacio).
      const slice = text.slice(start, end);
      const para = slice.lastIndexOf('\n\n');
      const nl = slice.lastIndexOf('\n');
      const sp = slice.lastIndexOf(' ');
      const cut = para > size * 0.5 ? para : nl > size * 0.5 ? nl : sp > size * 0.5 ? sp : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return parts;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Genera los chunks de una pagina.
 * @returns {Array<{indexSource,title,sourceUrl,chunkIndex,content,contentHash}>}
 */
export function chunkPage({ markdown, title, sourceUrl, indexSource, chunkSize, chunkOverlap }) {
  const sections = splitByHeadings(markdown);
  const chunks = [];
  let idx = 0;

  for (const section of sections) {
    const windows = windowize(section, chunkSize, chunkOverlap);
    for (const content of windows) {
      const trimmed = content.trim();
      if (!trimmed) continue;
      chunks.push({
        indexSource,
        title,
        sourceUrl,
        chunkIndex: idx,
        content: trimmed,
        contentHash: sha256(trimmed),
      });
      idx += 1;
    }
  }
  return chunks;
}
