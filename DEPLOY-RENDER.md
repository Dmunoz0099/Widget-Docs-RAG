# Despliegue en Render — Widget Docs RAG

Guía paso a paso para desplegar el backend (Express) en Render.
La BD ya está en Supabase (nube), el server ya lee `PORT` del entorno y ya
tiene `trust proxy` para el proxy de Render, así que hacen falta pocos ajustes.

---

## 1. Crear el servicio en Render

- **New → Web Service**, conecta el repo de GitHub.
- **Runtime:** Node
- **Build Command:** `pnpm install`
- **Start Command:** `pnpm start`  (equivale a `node src/server/index.js`)
- **Instance Type:** Free está bien para probar (ver avisos al final).

> Render inyecta su propia variable `PORT` — NO la fijes tú. `config.js` ya la
> lee (`intEnv('PORT', 3000)`), así que funciona solo.

---

## 2. Variables de entorno (en Render, NO en `.env`)

El `.env` está en `.gitignore`, así que no sube al repo. En Render →
**Environment**, agrega manualmente las mismas variables que hay en local:

```
DATABASE_URL=postgresql://...pooler.supabase.com:5432/postgres
AI_PROVIDER=openai
EMBEDDING_DIM=1536
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EMBED_MODEL=text-embedding-3-small
LLMS_INDEXES=...
MODULE_LABELS=...
RAG_TOP_N=5
CORS_ALLOWED_ORIGINS=...   <-- OJO, ver sección 3
```

Copia los valores tal cual del `.env` actual. Verifica que coincidan
`AI_PROVIDER` y `EMBEDDING_DIM` con el modelo de embeddings usado en la ingesta
(OpenAI text-embedding-3-small → 1536).

---

## 3. CORS — el punto clave

`CORS_ALLOWED_ORIGINS` debe contener **el origen de la página donde se incrusta
el widget**, NO la URL de Render. Ejemplos:

- Si pruebas con las páginas servidas desde el propio Render
  (`https://tu-app.onrender.com/test-ims.html`) → agrega
  `https://tu-app.onrender.com`.
- Si lo incrustas en los portales reales → agrega `https://ims.itam.app`,
  `https://backoffice.itam.app`, etc.

```
CORS_ALLOWED_ORIGINS=https://tu-app.onrender.com,https://ims.itam.app
```

Nunca uses `*` (el middleware lo prohíbe a propósito).

---

## 4. El `<script>` del widget en producción

Render da una URL tipo `https://tu-app.onrender.com`. En las páginas se cambia
`localhost:3000` por esa URL:

```html
<script
  src="https://tu-app.onrender.com/widget.js"
  data-api-url="https://tu-app.onrender.com"
  data-primary-color="#16a34a"
  data-docs-url="https://docs.itam.app/ims"
  data-manual="ims"
  async
></script>
```

(Si la página se sirve desde el mismo Render, `data-api-url` se puede omitir,
igual que en local.)

---

## 5. La ingesta NO corre en Render

Como la BD es Supabase (compartida en la nube), no hace falta re-ingestar en
Render. Los chunks ya están en Supabase y el server de Render los lee directo.
Si algún día se actualiza la doc, correr `pnpm ingest` **desde la PC** (escribe
en la misma Supabase) y listo.

---

## Avisos del plan Free de Render

1. **Cold start:** el servicio se duerme tras ~15 min de inactividad; la primera
   petición tarda ~50 s en despertar. Para demo está bien; para uso real, plan
   de pago o un ping periódico.
2. **Node 20:** el `package.json` pide `node >=20`. Render lo respeta, pero para
   fijarlo se puede agregar un archivo `.node-version` con `20` (o la variable
   `NODE_VERSION=20`).

---

## Checklist rápido

- [ ] Web Service creado (Build: `pnpm install`, Start: `pnpm start`)
- [ ] Variables de entorno cargadas en Render (todas las del `.env`)
- [ ] `CORS_ALLOWED_ORIGINS` con el origen real de la página del widget
- [ ] `<script>` de las páginas apuntando a la URL de Render
- [ ] Probar `https://tu-app.onrender.com/api/health` → `{ "status": "ok" }`
