# Widget Docs RAG

Widget de chat flotante con **RAG** que responde, en lenguaje natural, preguntas
de clientes sobre tu documentación pública de **GitBook**. Recupera contexto
desde **pgvector** (PostgreSQL de Supabase) y genera la respuesta con **Google
Gemini** (proveedor por defecto, con capa gratuita). La arquitectura está
desacoplada: puedes cambiar a **Claude** u **OpenAI** solo con variables de
entorno, sin tocar código.

- **Regla crítica:** el asistente responde **únicamente** con base en la
  documentación recuperada. Si la respuesta no está, lo dice explícitamente y
  sugiere contactar a soporte. No inventa.
- El widget es **100% autocontenido** (Shadow DOM) y se instala con **una sola
  línea** `<script src>`.

---

## Requisitos

- **Node.js ≥ 20** (probado con Node 26).
- **pnpm** (`npm i -g pnpm` si no lo tienes).
- Una base **PostgreSQL de Supabase** (plan gratis sirve; ya soporta pgvector).
- Una **API key de Google Gemini** (gratis en AI Studio).

---

## Estructura

```
widget-docs-rag/
├─ .env.example          # todas las variables documentadas
├─ package.json          # scripts pnpm
├─ test.html             # portal simulado que carga el widget
├─ public/
│  └─ widget.js          # widget autocontenido (Shadow DOM)
└─ src/
   ├─ config.js          # carga/valida env
   ├─ db.js              # pgvector: schema, upsert, búsqueda kNN
   ├─ providers/         # interfaz común + gemini/claude/openai + factory
   ├─ ingest/            # pipeline de ingesta (5 pasos)
   └─ server/            # Express: /api/chat, CORS, rate-limit
```

---

## 1. Configurar Supabase y la `DATABASE_URL`

1. Crea un proyecto en <https://supabase.com> (plan Free).
2. Ve a **Project Settings → Database → Connection string → URI**.
3. Copia la URI y sustituye `[YOUR-PASSWORD]` por tu contraseña real.
   - Si tu contraseña contiene `#`, escríbelo como `%23` en la URL.
   - Para la **ingesta** funciona bien la conexión directa (puerto `5432`).
4. No necesitas crear la extensión ni la tabla a mano: **el script de ingesta las
   crea** (`CREATE EXTENSION IF NOT EXISTS vector` + tabla `doc_chunks` + índices).

## 2. Obtener la API key de Gemini

1. Entra a <https://aistudio.google.com/app/apikey>.
2. Crea una API key y cópiala en `GEMINI_API_KEY`.

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y rellena como mínimo:

- `DATABASE_URL` — tu cadena de Supabase.
- `GEMINI_API_KEY` — tu API key.
- `LLMS_INDEXES` — lista de índices `llms.txt` (por ahora ya viene con
  `https://docs.itam.app/dps-pos/llms.txt`).
- `CORS_ALLOWED_ORIGINS` — dominios que podrán usar el widget. **Para probar en
  local añade** `http://localhost:3000`.

## 4. Instalar dependencias

```bash
pnpm install
```

## 5. Correr la ingesta

```bash
pnpm ingest
```

Esto, para **cada** índice de `LLMS_INDEXES`:

1. descarga el `llms.txt`,
2. parsea `- [Título](URL.md)` (tolerante a líneas no válidas),
3. descarga el Markdown de cada página (con un pequeño delay configurable),
4. lo trocea (chunking por headings + tamaño) conservando título + URL + sección,
5. genera embeddings y hace **upsert** en pgvector.

Es **re-ejecutable e idempotente**: no duplica, actualiza lo que cambió (por hash
de contenido) y elimina chunks obsoletos.

## 6. Levantar el servidor

```bash
pnpm start        # producción
pnpm dev          # con --watch (recarga al guardar)
```

Verás `Servidor escuchando en http://localhost:3000`.
Health check: <http://localhost:3000/api/health>.

## 7. Probar con `test.html`

Con el server corriendo, abre en el navegador:

```
http://localhost:3000/test.html
```

> Ábrela **a través del server** (no con doble clic / `file://`), para que el
> `Origin` sea `http://localhost:3000` y pase el CORS. Asegúrate de haber añadido
> `http://localhost:3000` a `CORS_ALLOWED_ORIGINS`.

Aparecerá el botón flotante abajo a la derecha. Haz una pregunta sobre la doc
ingestada; verás la respuesta y las **fuentes** (título + enlace).

---

## Capa gratuita de Gemini — límites a tener en cuenta

La free tier de Google Gemini tiene cuotas que afectan este proyecto:

- **Embeddings (`gemini-embedding-001`): ~100 requests/día.** La ingesta de la doc
  completa puede superarlo. No pasa nada: la ingesta es idempotente, así que al
  reiniciarse la cuota (cada 24 h) vuelves a correr `pnpm ingest` y **retoma solo
  lo que falta** (salta lo ya embebido por hash de contenido).
- **Chat:** algunos modelos (`gemini-2.0-flash`, `-lite`) pueden tener cuota 0 en
  free tier. Modelos verificados que **sí** funcionan gratis:
  `GEMINI_CHAT_MODEL=gemini-flash-latest` (o `gemini-flash-lite-latest`).
- El endpoint `/api/chat` genera **un embedding por pregunta**; si agotaste la
  cuota diaria de embeddings, las preguntas fallarán hasta el reinicio.

Para uso real sin estos topes, habilita **billing** en el proyecto de Google
(sube mucho los límites) o cambia el proveedor de embeddings a OpenAI.

## Agregar más manuales después

Añade la nueva URL de `llms.txt` a `LLMS_INDEXES` (separadas por coma) y vuelve a
correr `pnpm ingest`. **No se toca código.**

```env
LLMS_INDEXES=https://docs.itam.app/dps-pos/llms.txt,https://docs.itam.app/otro/llms.txt
```

---

## Cambiar de proveedor de IA (sin tocar código)

Todo se controla por `.env`:

- **Gemini (default):** `AI_PROVIDER=gemini`, `EMBEDDING_DIM=768`, `GEMINI_API_KEY=...`
- **OpenAI:** `AI_PROVIDER=openai`, `EMBEDDING_DIM=1536`, `OPENAI_API_KEY=...`
- **Claude (solo chat):** `AI_PROVIDER=claude`, `ANTHROPIC_API_KEY=...` y, como
  Anthropic **no** hace embeddings, define `EMBEDDING_PROVIDER=gemini` (u
  `openai`) con su key y la `EMBEDDING_DIM` correspondiente.

> ⚠️ Si cambias la **dimensión** de embeddings (p.ej. 768 → 1536), la tabla se
> crea con esa dimensión: hay que **re-ingestar** desde una tabla vacía.

---

## La única línea `<script src>` para el dev externo

Entrégale exactamente esto (ajustando tu dominio de backend en producción):

```html
<script src="https://TU-BACKEND/widget.js" async></script>
```

- El widget deduce la URL del backend del **origen desde el que se sirvió**
  `widget.js`. Si tu backend y el widget viven en el mismo host, no necesitas
  nada más.
- Si quieres forzar otra URL de API:

  ```html
  <script src="https://TU-BACKEND/widget.js" data-api-url="https://TU-API" async></script>
  ```

Recuerda que el dominio del portal que lo incruste debe estar en
`CORS_ALLOWED_ORIGINS`.

---

## Notas de despliegue

- **Backend:** cualquier host Node (Render, Railway, Fly, VPS). Define todas las
  variables de `.env` en el panel del host. El server ya usa `trust proxy` para
  leer la IP real (rate-limit) detrás de un proxy.
- **Base de datos:** la misma de Supabase; la ingesta puedes correrla desde tu
  máquina o desde el host.
- **CORS:** en producción pon los dominios reales de los portales; **nunca** uses
  `*`.
- **Rate limiting:** ajusta `RATE_LIMIT_WINDOW_MS` y `RATE_LIMIT_MAX` según tu
  tráfico.
- **Widget:** se sirve como archivo estático desde el propio backend
  (`/widget.js`), así el `<script src>` y la API comparten origen.

---

## Endpoints

| Método | Ruta           | Descripción                                    |
| ------ | -------------- | ---------------------------------------------- |
| POST   | `/api/chat`    | `{ question }` → `{ answer, sources[] }`       |
| GET    | `/api/health`  | Estado del server y conexión a la base         |
| GET    | `/widget.js`   | Widget autocontenido                           |
| GET    | `/test.html`   | Portal de prueba local                         |
