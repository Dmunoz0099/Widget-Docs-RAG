# Scripts de producción — Widget Docs RAG

Línea única (`<script>`) que se entrega a cada portal para incrustar el widget.
El backend y el widget se sirven desde el mismo host de producción:

**Backend:** `https://widget-docs-rag.onrender.com`

> Cada portal usa su propio `data-manual`, por lo que el selector "Módulo de la
> consulta" y las respuestas quedan acotados a la documentación de ese producto.

---

## 1) DPS POS

```html
<script
  src="https://widget-docs-rag.onrender.com/widget.js"
  data-api-url="https://widget-docs-rag.onrender.com"
  data-primary-color="#0014DB"
  data-accent-color="#000f8f"
  data-header-from="#3a4df0"
  data-header-to="#0014DB"
  data-docs-url="https://docs.itam.app/dps-pos"
  data-product-name="DPS POS"
  data-manual="dps-pos"
  async
></script>
```

## 2) IMS (Inventory Management System)

```html
<script
  src="https://widget-docs-rag.onrender.com/widget.js"
  data-api-url="https://widget-docs-rag.onrender.com"
  data-primary-color="#16a34a"
  data-accent-color="#15803d"
  data-header-from="#22c55e"
  data-header-to="#16a34a"
  data-docs-url="https://docs.itam.app/ims"
  data-product-name="Inventory Management System (IMS)"
  data-manual="ims"
  async
></script>
```

## 3) DigitalDTE

```html
<script
  src="https://widget-docs-rag.onrender.com/widget.js"
  data-api-url="https://widget-docs-rag.onrender.com"
  data-primary-color="#2f55d4"
  data-accent-color="#2442ad"
  data-header-from="#4667e0"
  data-header-to="#2f55d4"
  data-docs-url="https://docs.itam.app/digitaldte"
  data-product-name="DigitalDTE"
  data-manual="digitaldte"
  async
></script>
```

---

## Notas de despliegue

1. **CORS** — el backend solo responde a los orígenes en `CORS_ALLOWED_ORIGINS`.
   Asegúrate de incluir el dominio real donde se incrusta **cada** widget
   (p. ej. `https://ims.itam.app`, `https://backoffice.itam.app`,
   `https://ims.portal.digitalpharma.cl`, `https://accounts.digitaldte.com`).
   Si un portal vive en otro dominio, agrégalo a esa variable y redepliega.

2. **Identidad del usuario (opcional)** — si el portal conoce al usuario
   logueado, añade estos atributos para el saludo personalizado e historial por
   usuario:

   ```html
   data-user-id="123"
   data-user-name="Nombre Apellido"
   data-user-email="usuario@correo.com"
   ```

   Alternativa sin tocar el `<script>`: definir `window.__widgetUser = { id, name, email }`
   antes de cargarlo. Sin identidad, el widget genera un id anónimo persistente
   por navegador (historial local).

3. **Atributos opcionales de personalización** (si se quieren sobreescribir):
   - `data-brand-name` — nombre visible del asistente.
   - `data-welcome-title` / `data-welcome` — título y subtítulo del hero de bienvenida.
   - `data-modules="Administración,Reposición,..."` — fuerza el listado de módulos
     (por defecto se derivan de la documentación ingestada del `data-manual`).
