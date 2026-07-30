/** Descarga el Markdown de una pagina individual. */
export async function fetchPage(url) {
  const res = await fetch(url, { headers: { Accept: 'text/plain, text/markdown, */*' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al descargar ${url}`);
  }
  return res.text();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
