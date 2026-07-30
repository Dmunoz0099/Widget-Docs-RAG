# Prompt maestro — Widget de chat flotante con RAG

> Pega el bloque de abajo tal cual en Claude Code (en tu terminal).
> Construye el proyecto por fases; revisa la Fase 1 antes de dar OK para seguir.

---

Quiero construir un widget de chat flotante con RAG que responda, en lenguaje
natural, preguntas de clientes sobre la documentación pública de mi empresa
(alojada en GitBook). Actúa como arquitecto senior. Construye el proyecto por
FASES, y al terminar cada fase detente y espera mi OK antes de continuar.

=== CONTEXTO ===
- Stack: Node.js + Express + PostgreSQL. Es un proyecto personal desde cero.
  NO uso Docker. La base de datos es un PostgreSQL gestionado en Supabase (plan
  gratuito) que ya soporta pgvector. La cadena de conexión irá en la variable de
  entorno DATABASE_URL. El script de ingesta debe crear la extensión pgvector
  (CREATE EXTENSION IF NOT EXISTS vector) y la tabla necesaria si no existen, para
  que yo solo tenga que pegar mi DATABASE_URL y correrlo.

- Fuente de conocimiento: documentación PÚBLICA en GitBook, organizada en varios
  archivos índice llms.txt (uno por producto/sección). El pipeline debe leer las
  URLs de índice desde una LISTA configurable en variable de entorno o archivo de
  config (ej. LLMS_INDEXES), para poder agregar más adelante sin tocar código. Por
  AHORA la lista tendrá solo una: https://docs.itam.app/dps-pos/llms.txt (después
  agregaré más). OJO: cada llms.txt NO contiene el texto de los manuales, es un
  índice en Markdown donde cada línea es un enlace "- [Título](URL.md)" a una
  página individual. Cada URL .md devuelve Markdown limpio (ya verificado). El
  pipeline debe, para CADA índice de la lista: (1) descargar el llms.txt, (2)
  parsear cada línea extrayendo título y URL, tolerante a líneas que no sean
  enlaces válidos, (3) descargar el Markdown de cada URL con un pequeño delay entre
  descargas, (4) chunkear conservando título y URL de origen por chunk, (5)
  embeddear y guardar en pgvector. Debe ser re-ejecutable e idempotente (no
  duplicar; actualizar). Guarda también de qué índice/producto viene cada chunk,
  por si luego quiero filtrar por sección.

- LLM de respuestas y embeddings: usa Google Gemini (tiene capa gratuita para
  generación y embeddings) como proveedor por defecto, con la API key en variable
  de entorno. Mantén la arquitectura desacoplada (una interfaz común) para poder
  cambiar a Claude u OpenAI en producción cambiando solo variables de entorno, sin
  tocar la lógica.

- El widget se insertará en portales de terceros que yo NO controlo. Le pasaré a
  un dev externo SOLO una línea <script src>. El widget debe ser 100%
  autocontenido.

=== REQUISITOS TÉCNICOS ===
1. Base vectorial: pgvector sobre el PostgreSQL de Supabase. No montes otra base.

2. Pipeline de ingesta: script re-ejecutable e idempotente que recorra la lista de
   índices LLMS_INDEXES y ejecute los 5 pasos descritos arriba. Al re-ejecutar no
   debe duplicar chunks; debe actualizar.

3. Backend Express, endpoint POST /api/chat:
   - Recibe la pregunta, genera su embedding, recupera los N chunks más relevantes
     de pgvector, arma el prompt con ese contexto y llama a Gemini.
   - Devuelve la respuesta redactada + las fuentes (título + URL de los chunks
     usados).
   - REGLA CRÍTICA: responder ÚNICAMENTE con base en el contexto recuperado. Si el
     contexto no contiene la respuesta, decir explícitamente que esa información no
     está en la documentación y sugerir contactar a soporte. Prohibido inventar.
     Ponlo en el system prompt.
   - Rate limiting básico por IP (endpoint público).

4. CORS: lista blanca de orígenes por variable de entorno
   (ej. ims.itam.app, backoffice.itam.app). Nunca "*".

5. Widget frontend (widget.js autocontenido):
   - Inyecta un botón flotante + panel de chat, AISLADO con Shadow DOM para no
     chocar con los estilos del portal. z-index alto, carga async, diseño limpio y
     responsive. Muestra la respuesta y las fuentes como enlaces. Consume
     POST /api/chat.

6. Página de prueba local (test.html) que simule un portal cargando widget.js.

=== ENTREGABLES ===
- Estructura de carpetas clara (ingesta / backend / widget).
- .env.example con TODAS las variables documentadas.
- README con: configurar Supabase y la DATABASE_URL, obtener la API key de Gemini,
  configurar la lista LLMS_INDEXES, correr la ingesta, levantar el server, probar
  con test.html, y notas de despliegue.
- La ÚNICA línea <script src> final que le daré al dev externo.

Empieza mostrándome (a) la arquitectura general, (b) la estructura de carpetas y
(c) el esquema de la tabla de pgvector. Espera mi OK antes de escribir código.

---

## Antes de correrlo, ten a mano

- **DATABASE_URL** de Supabase (con la contraseña ya sustituida, el `#` como `%23` si aplica).
- **API key de Google Gemini** (de aistudio.google.com).
- La URL del índice ya va dentro del prompt: `https://docs.itam.app/dps-pos/llms.txt`

## Qué esperar

Claude Code responderá con la **Fase 1** (arquitectura + estructura de carpetas +
esquema de la tabla pgvector) y se detendrá a esperar tu OK. Revísala antes de
dejar que escriba código.

## Para agregar más manuales después

Añade la nueva URL de `llms.txt` a la lista `LLMS_INDEXES` y vuelve a correr la
ingesta. Nada de tocar código.
