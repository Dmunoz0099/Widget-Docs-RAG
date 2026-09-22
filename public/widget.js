/**
 * Widget de chat flotante con RAG, estilo TALANA. 100% autocontenido.
 * - Se inyecta con una sola linea <script src>.
 * - Aislado con Shadow DOM (no choca con estilos del portal).
 * - Multi-pantalla: Inicio · Conversaciones · Chat.
 * - Saludo por nombre, historial por usuario y selector "Modulo de la consulta".
 * - Paleta adaptable por portal via atributos del <script>.
 *
 * Config (atributos del <script> o window.__widgetUser):
 *   data-api-url          URL del backend (por defecto: origen del widget.js)
 *   data-user-id          id del usuario logueado en el portal
 *   data-user-name        nombre del usuario (para el saludo)
 *   data-user-email       (opcional)
 *   data-primary-color    color principal (botones, burbuja de usuario)
 *   data-accent-color     color de acciones oscuras ("Nueva conversacion", "Siguiente")
 *   data-header-from      inicio del gradiente del header
 *   data-header-to        fin del gradiente del header
 *   data-docs-url         URL de la documentacion (menu "Centro de Ayuda" / "Articulos")
 *   data-brand-name       nombre visible del asistente (por defecto "Asistente")
 *   data-product-name     nombre del producto/portal para el saludo (p.ej. "DigitalDTE")
 *   data-welcome-title    titulo del hero de bienvenida (por defecto "¡Hola! Soy la IA de {producto}")
 *   data-welcome          subtitulo del hero de bienvenida
 *   data-manual           index_source del manual de este portal (p.ej. "ims"): el
 *                         widget solo muestra/consulta los modulos de ese manual.
 *
 *   Alternativa a los data-user-*:  window.__widgetUser = { id, name, email }
 */
(function () {
  'use strict';

  if (window.__docsRagWidgetLoaded) return;
  window.__docsRagWidgetLoaded = true;

  // --- Resolver script y configuracion --------------------------------------
  var currentScript =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

  function attr(name, fallback) {
    var v = currentScript && currentScript.getAttribute(name);
    return v != null && v !== '' ? v : fallback;
  }

  var apiUrl =
    attr('data-api-url', null) ||
    (currentScript && currentScript.src
      ? new URL(currentScript.src).origin
      : window.location.origin);
  apiUrl = apiUrl.replace(/\/$/, '');

  // Identidad: atributos del <script> o window.__widgetUser.
  var injectedUser = window.__widgetUser || {};
  var userName = attr('data-user-name', injectedUser.name || '');
  var userId = attr('data-user-id', injectedUser.id || '');
  var userEmail = attr('data-user-email', injectedUser.email || '');

  // Sin user-id: generamos uno anonimo persistente (historial por navegador).
  if (!userId) {
    try {
      userId = localStorage.getItem('docsRagAnonId');
      if (!userId) {
        userId = 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('docsRagAnonId', userId);
      }
    } catch (e) {
      userId = 'anon-' + Date.now().toString(36);
    }
  }

  var docsUrl = attr('data-docs-url', '');
  var brandName = attr('data-brand-name', 'Asistente');
  // Bienvenida tipo "hero" (avatar + titulo + subtitulo). El titulo usa el
  // nombre del producto (data-product-name); data-welcome-title y data-welcome
  // permiten sobreescribir titulo y subtitulo por portal.
  var productName = attr('data-product-name', '').trim();
  var welcomeTitle = attr('data-welcome-title', '').trim() ||
    (productName ? '¡Hola! Soy la IA de ' + productName : '¡Hola! Soy tu asistente virtual');
  var welcomeText = attr('data-welcome', '').trim() ||
    'Estoy aquí para resolver tus dudas sobre la plataforma y guiarte paso a paso cuando lo necesites.';
  var firstName = (userName || '').trim().split(/\s+/)[0] || '';

  // Manual (index_source) al que pertenece este portal. Si se declara, el widget
  // solo muestra/consulta los modulos de ese manual (p.ej. el portal IMS ->
  // data-manual="ims"). Sin el, muestra los modulos de toda la documentacion.
  var manualIndex = attr('data-manual', '').trim();

  // Modulos del portal (para el selector "Modulo de la consulta").
  // Se declaran en el <script> con data-modules="Administración,Reposición,...".
  // Si no se declaran, se caen al listado de manuales ingestados (/api/modules).
  var portalModules = attr('data-modules', '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean)
    .map(function (name) { return { id: name, label: name }; });

  // Tema. Si solo hay primary, el gradiente se deriva de el.
  var primary = attr('data-primary-color', '#7c3aed');
  var accent = attr('data-accent-color', '#1f2544');
  var headerFrom = attr('data-header-from', attr('data-primary-color', '#8b5cf6'));
  var headerTo = attr('data-header-to', primary);

  // --- Estilos (dentro del Shadow DOM) --------------------------------------
  var CSS = `
    :host {
      all: initial;
      --wg-primary: ${primary};
      --wg-accent: ${accent};
      --wg-header-from: ${headerFrom};
      --wg-header-to: ${headerTo};
      --wg-bg: #ffffff;
      --wg-soft: #f3f4fa;
      --wg-text: #191c28;
      --wg-muted: #6b7280;
      --wg-border: #e9eaf1;
      --wg-ring: color-mix(in srgb, var(--wg-primary) 20%, transparent);
      --wg-tint: color-mix(in srgb, var(--wg-primary) 8%, #fff);
      --wg-grad: linear-gradient(135deg, var(--wg-header-from), var(--wg-header-to));
      --wg-sh-sm: 0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.08);
      --wg-sh-md: 0 6px 16px rgba(17,24,39,.08), 0 2px 6px rgba(17,24,39,.05);
      --wg-sh-lg: 0 24px 60px -14px rgba(17,24,39,.34), 0 10px 24px -12px rgba(17,24,39,.24);
    }
    * { box-sizing: border-box; }

    .fab {
      position: fixed; bottom: 22px; right: 22px; z-index: 2147483000;
      width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
      background: var(--wg-grad); color: #fff;
      box-shadow: 0 10px 26px -6px color-mix(in srgb, var(--wg-primary) 55%, transparent),
                  0 6px 14px rgba(17,24,39,.22);
      display: flex; align-items: center; justify-content: center;
      transition: transform .22s cubic-bezier(.16, 1, .3, 1), box-shadow .22s ease;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .fab::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
      animation: fabPulse 2.8s ease-out infinite;
    }
    .fab:hover {
      transform: translateY(-2px) scale(1.06);
      box-shadow: 0 16px 34px -8px color-mix(in srgb, var(--wg-primary) 60%, transparent),
                  0 8px 18px rgba(17,24,39,.26);
    }
    .fab:active { transform: scale(.97); }
    .fab svg { width: 27px; height: 27px; position: relative; }
    @keyframes fabPulse {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--wg-primary) 42%, transparent); }
      70%, 100% { box-shadow: 0 0 0 16px transparent; }
    }
    @media (prefers-reduced-motion: reduce) { .fab::after { animation: none; } }

    .panel {
      position: fixed; bottom: 94px; right: 22px; z-index: 2147483000;
      width: 384px; max-width: calc(100vw - 32px);
      height: 620px; max-height: calc(100vh - 130px);
      background: var(--wg-bg); border-radius: 20px; overflow: hidden;
      box-shadow: var(--wg-sh-lg);
      display: flex; flex-direction: column;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: var(--wg-text);
      transform-origin: bottom right;
      opacity: 0; visibility: hidden;
      transform: translateY(16px) scale(.94);
      transition: opacity .2s ease,
                  transform .28s cubic-bezier(.16, 1, .3, 1),
                  visibility 0s linear .28s;
    }
    .panel.open {
      opacity: 1; visibility: visible;
      transform: translateY(0) scale(1);
      transition: opacity .24s ease,
                  transform .34s cubic-bezier(.16, 1, .3, 1),
                  visibility 0s;
    }
    @media (prefers-reduced-motion: reduce) {
      .panel, .panel.open { transition: opacity .15s ease, visibility 0s; transform: none; }
    }

    /* --- Header --- */
    .header {
      position: relative; overflow: hidden;
      background: var(--wg-grad);
      color: #fff; padding: 18px 18px 20px;
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 8px; flex-shrink: 0;
    }
    .header::before {
      content: ''; position: absolute; top: -65%; right: -12%;
      width: 220px; height: 220px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,.22), transparent 70%);
      pointer-events: none;
    }
    .header .htext { min-width: 0; position: relative; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; }
    .header h1:empty { display: none; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: .92; }
    .header p:empty { display: none; }
    .header .hbtns { display: flex; gap: 6px; align-items: center; position: relative; }
    .header button {
      background: rgba(255,255,255,.16); border: none; color: #fff; cursor: pointer;
      width: 32px; height: 32px; border-radius: 10px; font-size: 18px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s ease, transform .15s ease;
    }
    .header button:hover { background: rgba(255,255,255,.30); transform: translateY(-1px); }
    .header button:active { transform: scale(.94); }
    .header .back { font-size: 20px; }

    /* --- Cuerpo con scroll --- */
    .body {
      flex: 1; overflow-y: auto; background: var(--wg-soft);
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--wg-muted) 38%, transparent) transparent;
    }
    .body::-webkit-scrollbar { width: 9px; }
    .body::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--wg-muted) 30%, transparent);
      border-radius: 9px; border: 2.5px solid transparent; background-clip: content-box;
    }
    .body::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--wg-muted) 48%, transparent); background-clip: content-box;
    }
    .screen { display: none; }
    .screen.active { display: block; animation: scrIn .3s cubic-bezier(.16, 1, .3, 1) both; }
    @keyframes scrIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .screen.active { animation: none; } }

    /* --- Menu de opciones (home) --- */
    .menu { padding: 4px 16px 14px; display: flex; flex-direction: column; gap: 8px; }
    .menu-item {
      display: flex; gap: 12px; align-items: center; width: 100%;
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 14px;
      text-align: left; cursor: pointer; padding: 12px;
      box-shadow: var(--wg-sh-sm); font-family: inherit; color: var(--wg-text);
      transition: transform .16s cubic-bezier(.16, 1, .3, 1), box-shadow .16s ease, border-color .16s ease;
    }
    .menu-item:hover {
      transform: translateY(-2px); box-shadow: var(--wg-sh-md);
      border-color: color-mix(in srgb, var(--wg-primary) 40%, var(--wg-border));
    }
    .menu-item:active { transform: translateY(0); }
    .menu-item .ic {
      width: 38px; height: 38px; flex-shrink: 0; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--wg-primary) 18%, #fff),
        color-mix(in srgb, var(--wg-primary) 7%, #fff));
      color: var(--wg-primary);
    }
    .menu-item .ic svg { width: 19px; height: 19px; }
    .menu-item .mtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .menu-item .mt { display: block; font-size: 13.5px; font-weight: 700; line-height: 1.3; }
    .menu-item .md { display: block; font-size: 12px; color: var(--wg-muted); line-height: 1.4; }
    .menu-item::after {
      content: ''; flex-shrink: 0; width: 8px; height: 8px; align-self: center; margin-left: 2px;
      border-right: 2px solid var(--wg-muted); border-top: 2px solid var(--wg-muted);
      border-radius: 1px; transform: rotate(45deg); opacity: .45;
      transition: transform .16s ease, opacity .16s ease, border-color .16s ease;
    }
    .menu-item:hover::after {
      opacity: 1; border-color: var(--wg-primary); transform: translateX(3px) rotate(45deg);
    }

    /* --- Lista de conversaciones --- */
    .convos { padding: 14px 16px 90px; display: flex; flex-direction: column; gap: 10px; }
    .convo {
      display: flex; gap: 12px; align-items: flex-start; width: 100%;
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 15px;
      padding: 13px; cursor: pointer; text-align: left; box-shadow: var(--wg-sh-sm);
      font-family: inherit; color: var(--wg-text);
      transition: transform .16s cubic-bezier(.16, 1, .3, 1), box-shadow .16s ease, border-color .16s ease;
    }
    .convo:hover {
      transform: translateY(-2px); box-shadow: var(--wg-sh-md);
      border-color: color-mix(in srgb, var(--wg-primary) 35%, var(--wg-border));
    }
    .convo:active { transform: translateY(0); }
    .convo .cav {
      width: 40px; height: 40px; border-radius: 13px; flex-shrink: 0;
      background: var(--wg-grad); color: #fff;
      display: flex; align-items: center; justify-content: center;
    }
    .convo .cav svg { width: 20px; height: 20px; }
    .convo .cbody { min-width: 0; flex: 1; }
    .convo .ct { font-size: 13.5px; font-weight: 700; }
    .convo .cp { font-size: 12.5px; color: var(--wg-muted); margin-top: 3px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .convo .cmeta { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
    .tag {
      font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
      background: var(--wg-tint); color: var(--wg-primary);
    }
    .badge {
      font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 999px;
      background: #eef0f5; color: var(--wg-muted);
    }
    .empty { text-align: center; color: var(--wg-muted); font-size: 13px; padding: 44px 24px; line-height: 1.55; }

    /* --- Bienvenida (hero) --- */
    .welcome { position: relative; text-align: center; padding: 18px 22px 8px; animation: wIn .5s cubic-bezier(.16, 1, .3, 1) both; }
    .welcome::before {
      content: ''; position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      width: 170px; height: 170px; border-radius: 50%; z-index: 0; pointer-events: none;
      background: radial-gradient(circle, color-mix(in srgb, var(--wg-primary) 15%, transparent), transparent 68%);
    }
    .welcome .wavatar {
      position: relative; z-index: 1;
      width: 58px; height: 58px; border-radius: 18px; margin: 0 auto 11px;
      background: var(--wg-grad);
      display: flex; align-items: center; justify-content: center; color: #fff;
      box-shadow: 0 14px 28px -8px color-mix(in srgb, var(--wg-primary) 55%, transparent);
      animation: wFloat 3.4s ease-in-out infinite;
    }
    .welcome .wavatar::after {
      content: ''; position: absolute; inset: -5px; border-radius: 22px;
      border: 1.5px solid color-mix(in srgb, var(--wg-primary) 28%, transparent);
    }
    .welcome .wavatar svg { width: 29px; height: 29px; }
    .welcome .wtitle { position: relative; z-index: 1; font-size: 17px; font-weight: 800; color: var(--wg-text); margin: 0 0 6px; letter-spacing: -.01em; }
    .welcome .wsub { position: relative; z-index: 1; font-size: 13px; line-height: 1.45; color: var(--wg-muted); max-width: 288px; margin: 0 auto; }
    @keyframes wIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @keyframes wFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) {
      .welcome, .welcome .wavatar { animation: none; }
    }

    .newconvo-wrap {
      position: absolute; left: 0; right: 0; bottom: 40px; padding: 12px 16px;
      background: linear-gradient(to top, var(--wg-soft) 70%, transparent);
    }
    .newconvo {
      width: 100%; border: none; border-radius: 14px; padding: 14px;
      background: var(--wg-grad); color: #fff; font-size: 14px; font-weight: 700;
      cursor: pointer; font-family: inherit;
      box-shadow: 0 10px 22px -8px color-mix(in srgb, var(--wg-primary) 55%, transparent);
      transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
    }
    .newconvo:hover {
      transform: translateY(-2px); filter: brightness(1.05);
      box-shadow: 0 16px 28px -8px color-mix(in srgb, var(--wg-primary) 60%, transparent);
    }
    .newconvo:active { transform: translateY(0); }

    /* --- Chat --- */
    .messages { padding: 16px; }
    /* Sin mensajes aun (paso de seleccion de modulo): sin padding para que la
       tarjeta de modulo no quede con un hueco en blanco arriba. */
    .messages:empty { padding: 0; }
    .msg { margin-bottom: 12px; display: flex; animation: msgIn .28s cubic-bezier(.16, 1, .3, 1) both; }
    .msg.user { justify-content: flex-end; }
    .bubble {
      max-width: 86%; padding: 11px 14px; border-radius: 16px; font-size: 14px;
      line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;
    }
    .msg.user .bubble {
      background: var(--wg-grad); color: #fff; border-bottom-right-radius: 5px;
      box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--wg-primary) 45%, transparent);
    }
    .msg.bot .bubble {
      background: var(--wg-bg); color: var(--wg-text); border: 1px solid var(--wg-border);
      border-bottom-left-radius: 5px; box-shadow: var(--wg-sh-sm);
    }
    @keyframes msgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .msg { animation: none; } }

    /* Contenido Markdown renderizado (respuestas del bot) */
    .md { white-space: normal; }
    .md > :first-child { margin-top: 0; }
    .md > :last-child { margin-bottom: 0; }
    .md p { margin: 0 0 8px; }
    .md h1, .md h2, .md h3, .md h4 { margin: 12px 0 6px; font-weight: 700; line-height: 1.3; }
    .md h1 { font-size: 16px; }
    .md h2 { font-size: 15px; }
    .md h3, .md h4 { font-size: 14px; }
    .md ul, .md ol { margin: 6px 0 8px; padding-left: 20px; }
    .md ul { list-style: disc; }
    .md li { margin: 4px 0; }
    .md li::marker { color: var(--wg-primary); font-weight: 600; }
    .md strong { font-weight: 700; }
    .md em { font-style: italic; }
    .md a { color: var(--wg-primary); text-decoration: underline; word-break: break-word; }
    .md code { background: rgba(100, 116, 139, .14); padding: 1px 5px; border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
    .md pre { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px;
      overflow-x: auto; margin: 8px 0; }
    .md pre code { background: none; padding: 0; color: inherit; }
    .md hr { border: 0; border-top: 1px solid var(--wg-border); margin: 10px 0; }
    .md blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid var(--wg-primary);
      color: var(--wg-muted); }

    .sources { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--wg-border); font-size: 12px; }
    .sources .lbl { color: var(--wg-muted); margin-bottom: 4px; }
    .sources a { display: block; color: var(--wg-primary); text-decoration: none; margin-bottom: 2px; }
    .sources a:hover { text-decoration: underline; }

    /* Opciones de clarificacion clicables (bajo una respuesta del bot) */
    .options { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .options.done { opacity: .55; pointer-events: none; }
    .opt {
      width: 100%; text-align: left; cursor: pointer; font-family: inherit;
      background: var(--wg-tint);
      border: 1px solid color-mix(in srgb, var(--wg-primary) 28%, #fff);
      color: var(--wg-primary); border-radius: 11px; padding: 10px 13px;
      font-size: 13.5px; font-weight: 600; line-height: 1.3;
      transition: background .14s ease, transform .14s ease, border-color .14s ease;
    }
    .opt:hover {
      background: color-mix(in srgb, var(--wg-primary) 15%, #fff);
      border-color: color-mix(in srgb, var(--wg-primary) 45%, #fff); transform: translateX(2px);
    }

    .typing { display: inline-flex; gap: 4px; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: blink 1.2s infinite; }
    .typing span:nth-child(2) { animation-delay: .2s; }
    .typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

    /* Tarjeta selector de modulo */
    .modcard {
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 16px;
      padding: 16px; margin: 16px 16px 12px; box-shadow: var(--wg-sh-sm);
    }
    .modcard h3 { margin: 0 0 5px; font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
    .modcard p { margin: 0 0 12px; font-size: 12.5px; color: var(--wg-muted); line-height: 1.4; }
    .modcard label { font-size: 12px; font-weight: 700; display: block; margin-bottom: 6px; color: var(--wg-text); }

    /* Dropdown personalizado (reemplaza al <select> nativo, no estilable) */
    .modsel { position: relative; }
    .modsel-btn {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 11px 13px; border: 1.5px solid var(--wg-border); border-radius: 12px;
      background: var(--wg-bg); color: var(--wg-text); font-family: inherit; font-size: 14px;
      cursor: pointer; text-align: left;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .modsel-btn:hover { border-color: color-mix(in srgb, var(--wg-primary) 40%, var(--wg-border)); }
    .modsel.open .modsel-btn { border-color: var(--wg-primary); box-shadow: 0 0 0 3px var(--wg-ring); }
    .modsel-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .modsel-arrow { display: flex; flex-shrink: 0; color: var(--wg-muted); transition: transform .18s ease, color .18s ease; }
    .modsel-arrow svg { width: 16px; height: 16px; }
    .modsel.open .modsel-arrow { transform: rotate(180deg); color: var(--wg-primary); }
    .modsel-list {
      position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 5;
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 12px;
      box-shadow: var(--wg-sh-lg); padding: 6px; max-height: 244px; overflow-y: auto;
      scrollbar-width: thin;
      opacity: 0; visibility: hidden; transform: translateY(-6px) scale(.98); transform-origin: top;
      transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s;
    }
    .modsel.open .modsel-list {
      opacity: 1; visibility: visible; transform: none;
      transition: opacity .18s ease, transform .18s cubic-bezier(.16, 1, .3, 1), visibility 0s;
    }
    .modsel-opt {
      width: 100%; text-align: left; border: none; background: none; cursor: pointer; font-family: inherit;
      font-size: 13.5px; color: var(--wg-text); padding: 9px 11px; border-radius: 9px;
      display: flex; align-items: center; gap: 8px;
      transition: background .12s ease, color .12s ease;
    }
    .modsel-opt:hover { background: var(--wg-tint); color: var(--wg-primary); }
    .modsel-opt.sel { background: var(--wg-tint); color: var(--wg-primary); font-weight: 700; }
    .modsel-opt.sel::after {
      content: ''; margin-left: auto; flex-shrink: 0; width: 6px; height: 10px;
      border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
      transform: rotate(45deg); margin-top: -3px;
    }
    .modcard .row { display: flex; justify-content: flex-end; margin-top: 14px; }
    .modcard .next {
      border: none; background: var(--wg-grad); color: #fff; border-radius: 12px;
      padding: 10px 22px; cursor: pointer; font-size: 14px; font-weight: 700; font-family: inherit;
      box-shadow: 0 8px 18px -6px color-mix(in srgb, var(--wg-primary) 50%, transparent);
      transition: transform .16s ease, filter .16s ease, box-shadow .16s ease;
    }
    .modcard .next:hover {
      transform: translateY(-2px); filter: brightness(1.05);
      box-shadow: 0 12px 22px -6px color-mix(in srgb, var(--wg-primary) 55%, transparent);
    }
    .modcard .next:active { transform: translateY(0); }

    /* --- Composer --- */
    .composer { display: flex; padding: 12px; gap: 8px; border-top: 1px solid var(--wg-border); background: var(--wg-bg); flex-shrink: 0; align-items: flex-end; }
    .composer.hidden { display: none; }
    .composer textarea {
      flex: 1; resize: none; border: 1.5px solid var(--wg-border); border-radius: 13px;
      padding: 11px 14px; font-size: 14px; font-family: inherit; max-height: 96px; outline: none; color: var(--wg-text);
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .composer textarea:focus { border-color: var(--wg-primary); box-shadow: 0 0 0 3px var(--wg-ring); }
    .composer button {
      border: none; background: var(--wg-grad); color: #fff; border-radius: 13px;
      padding: 0 18px; height: 44px; flex-shrink: 0; cursor: pointer; font-size: 14px; font-weight: 700;
      box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--wg-primary) 50%, transparent);
      transition: transform .16s ease, filter .16s ease;
    }
    .composer button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
    .composer button:active:not(:disabled) { transform: translateY(0); }
    .composer button:disabled { opacity: .45; cursor: default; box-shadow: none; }

    /* --- Nav inferior --- */
    .nav {
      display: flex; gap: 4px; padding: 5px 8px; border-top: 1px solid var(--wg-border);
      background: var(--wg-bg); flex-shrink: 0;
    }
    .nav button {
      position: relative; flex: 1; background: none; border: none; cursor: pointer; padding: 8px 4px;
      display: flex; flex-direction: column; align-items: center; gap: 3px; border-radius: 12px;
      color: var(--wg-muted); font-size: 11px; font-weight: 600; font-family: inherit;
      transition: color .15s ease, background .15s ease;
    }
    .nav button:hover { color: var(--wg-text); background: color-mix(in srgb, var(--wg-primary) 6%, transparent); }
    .nav button svg { width: 21px; height: 21px; }
    .nav button.active { color: var(--wg-primary); }
    .nav button.active::before {
      content: ''; position: absolute; top: -5px; left: 50%; transform: translateX(-50%);
      width: 26px; height: 3px; border-radius: 0 0 3px 3px; background: var(--wg-primary);
    }

    @media (max-width: 420px) {
      .panel { right: 8px; bottom: 84px; width: calc(100vw - 16px); height: calc(100vh - 104px); }
      .fab { right: 14px; bottom: 14px; }
    }
  `;

  // --- SVG helpers -----------------------------------------------------------
  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
    msgs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"></path></svg>',
    articles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    // Burbuja de chat + destello (sparkle): asistente de IA por chat. Se usa en
    // el boton flotante y en el avatar del hero de bienvenida.
    assistant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"></path><path d="M12 6.2 L13.15 9.35 L16.3 10.5 L13.15 11.65 L12 14.8 L10.85 11.65 L7.7 10.5 L10.85 9.35 Z" fill="currentColor" stroke="none"></path></svg>',
  };

  // --- Construccion del DOM ---------------------------------------------------
  var host = document.createElement('div');
  host.id = 'docs-rag-widget-host';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  var container = document.createElement('div');
  container.innerHTML = `
    <button class="fab" aria-label="Abrir chat de ayuda">${ICONS.assistant}</button>
    <div class="panel" role="dialog" aria-label="Chat de ayuda">
      <div class="header">
        <div class="htext">
          <button class="back" aria-label="Atras" style="display:none">&larr;</button>
          <h1 class="htitle"></h1>
          <p class="hsub"></p>
        </div>
        <div class="hbtns">
          <button class="close" aria-label="Cerrar">&times;</button>
        </div>
      </div>

      <div class="body">
        <!-- INICIO -->
        <div class="screen screen-home">
          <div class="welcome welcome-home"></div>
          <div class="menu"></div>
        </div>

        <!-- CONVERSACIONES -->
        <div class="screen screen-convos" style="position:relative">
          <div class="convos"></div>
          <div class="newconvo-wrap">
            <button class="newconvo">Nueva conversación</button>
          </div>
        </div>

        <!-- CHAT -->
        <div class="screen screen-chat">
          <div class="messages"></div>
          <div class="modcard-slot"></div>
        </div>
      </div>

      <div class="composer hidden">
        <textarea rows="1" placeholder="Escribe tu pregunta..." aria-label="Tu pregunta"></textarea>
        <button class="send">Enviar</button>
      </div>

      <div class="nav">
        <button class="nav-home active">${ICONS.home}<span>Inicio</span></button>
        <button class="nav-convos">${ICONS.msgs}<span>Conversaciones</span></button>
        <button class="nav-articles">${ICONS.articles}<span>Artículos</span></button>
      </div>
    </div>
  `;
  root.appendChild(container);

  // --- Referencias -----------------------------------------------------------
  var $ = function (sel) { return root.querySelector(sel); };
  var fab = $('.fab');
  var panel = $('.panel');
  var closeBtn = $('.close');
  var backBtn = $('.back');
  var hTitle = $('.htitle');
  var hSub = $('.hsub');
  var screenHome = $('.screen-home');
  var screenConvos = $('.screen-convos');
  var screenChat = $('.screen-chat');
  var welcomeHome = $('.welcome-home');
  var menuEl = $('.menu');
  var convosEl = $('.convos');
  var newConvoBtn = $('.newconvo');
  var modSlot = $('.modcard-slot');
  var messages = $('.messages');
  var composer = $('.composer');
  var textarea = $('textarea');
  var sendBtn = $('.send');
  var navHome = $('.nav-home');
  var navConvos = $('.nav-convos');
  var navArticles = $('.nav-articles');

  // --- Estado ----------------------------------------------------------------
  var state = {
    screen: 'home',
    conversationId: null,
    moduleId: null,      // clave de filtro del modulo (null = todos)
    moduleLabel: null,   // etiqueta visible del modulo
    modules: null,       // cache de modulos (/api/modules o data-modules)
    convosCache: null,   // cache de la lista de conversaciones
    convosDirty: false,  // true cuando hay que recargar (tras enviar mensaje)
    started: false,
    busy: false,
  };

  // --- API -------------------------------------------------------------------
  function api(path, opts) {
    return fetch(apiUrl + path, opts).then(function (res) {
      if (!res.ok) return res.json().then(function (e) { throw new Error(e.error || 'Error'); });
      return res.json();
    });
  }

  function loadModules() {
    if (state.modules) return Promise.resolve(state.modules);
    // Prioriza los modulos declarados por el portal (data-modules).
    if (portalModules.length) {
      state.modules = portalModules;
      return Promise.resolve(state.modules);
    }
    // Modulos derivados de la doc ingestada. Si el portal declara su manual
    // (data-manual), se piden solo los de ese manual.
    var path = '/api/modules' + (manualIndex ? '?index=' + encodeURIComponent(manualIndex) : '');
    return api(path, {}).then(function (d) {
      state.modules = d.modules || [];
      return state.modules;
    }).catch(function () { return []; });
  }

  // --- Helpers de fecha ------------------------------------------------------
  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) +
        ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // --- Router ----------------------------------------------------------------
  function showScreen(name) {
    state.screen = name;
    screenHome.classList.toggle('active', name === 'home');
    screenConvos.classList.toggle('active', name === 'convos');
    screenChat.classList.toggle('active', name === 'chat');

    navHome.classList.toggle('active', name === 'home');
    navConvos.classList.toggle('active', name === 'convos');
    navArticles.classList.remove('active');

    backBtn.style.display = name === 'chat' ? 'inline-flex' : 'none';
    composer.classList.toggle('hidden', name !== 'chat' || !state.started);

    if (name === 'home') {
      // La bienvenida la da el hero (avatar + titulo + subtitulo) dentro del
      // cuerpo; la cabecera en Inicio queda limpia (solo el boton de cerrar).
      hTitle.textContent = '';
      hSub.textContent = '';
    } else if (name === 'convos') {
      hTitle.textContent = '¡Conversemos!';
      hSub.textContent = 'Estamos disponibles para apoyarte 👋';
    }
  }

  // --- INICIO: menu ----------------------------------------------------------
  function renderMenu() {
    menuEl.innerHTML = '';
    var items = [
      { ic: 'chat', t: 'Chatea con nosotros', d: 'Resuelve tus dudas al instante con el asistente.', action: startNewConversation },
    ];
    if (docsUrl) {
      items.push({ ic: 'book', t: 'Centro de Ayuda', d: 'Explora artículos y la documentación oficial.', href: docsUrl });
    }
    items.push({ ic: 'msgs', t: 'Mis conversaciones', d: 'Revisa tus consultas anteriores.', action: openConversations });

    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'menu-item';
      b.innerHTML = '<span class="ic">' + ICONS[it.ic] + '</span>' +
        '<span class="mtext"><span class="mt">' + it.t + '</span><span class="md">' + it.d + '</span></span>';
      b.addEventListener('click', function () {
        if (it.href) window.open(it.href, '_blank', 'noopener');
        else if (it.action) it.action();
      });
      menuEl.appendChild(b);
    });
  }

  // --- CONVERSACIONES --------------------------------------------------------
  function renderConversations(list) {
    if (!list || !list.length) {
      convosEl.innerHTML = '<div class="empty">Aún no tienes conversaciones.<br>Inicia una nueva abajo.</div>';
      return;
    }
    convosEl.innerHTML = '';
    list.forEach(function (c) {
      var el = document.createElement('button');
      el.className = 'convo';
      var moduleLabel = c.module_label || '';
      el.innerHTML =
        '<span class="cav">' + ICONS.chat + '</span>' +
        '<span class="cbody">' +
          '<span class="ct">' + escapeHtml(c.title || 'Conversación') + '</span>' +
          '<span class="cp">' + fmtDate(c.updated_at) + '</span>' +
          '<span class="cmeta">' +
            (moduleLabel ? '<span class="tag">' + escapeHtml(moduleLabel) + '</span>' : '') +
            '<span class="badge">Finalizada</span>' +
          '</span>' +
        '</span>';
      el.addEventListener('click', function () { openConversation(c); });
      convosEl.appendChild(el);
    });
  }

  function openConversations() {
    showScreen('convos');

    // Usa la cache si esta fresca: evita recargar al ir y volver entre pantallas.
    if (state.convosCache && !state.convosDirty) {
      renderConversations(state.convosCache);
      return;
    }

    convosEl.innerHTML = '<div class="empty">Cargando...</div>';
    api('/api/conversations?userId=' + encodeURIComponent(userId), {})
      .then(function (d) {
        state.convosCache = d.conversations || [];
        state.convosDirty = false;
        renderConversations(state.convosCache);
      })
      .catch(function () {
        convosEl.innerHTML = '<div class="empty">No se pudo cargar el historial.</div>';
      });
  }

  // --- CHAT ------------------------------------------------------------------
  function resetChat() {
    messages.innerHTML = '';
    modSlot.innerHTML = '';
    state.conversationId = null;
    state.moduleId = null;
    state.moduleLabel = null;
    state.started = false;
  }

  // Hero de bienvenida en la pantalla de Inicio: avatar con gradiente + titulo +
  // subtitulo (centrado). Titulo/subtitulo vienen de data-* del portal; se
  // insertan como texto plano. Se pinta una vez al construir el widget.
  // El avatar usa el mismo ícono que el boton flotante (burbuja + destello).
  function renderHomeWelcome() {
    if (!welcomeHome) return;
    welcomeHome.innerHTML = '';
    var av = document.createElement('div');
    av.className = 'wavatar';
    av.innerHTML = ICONS.assistant;
    var t = document.createElement('div');
    t.className = 'wtitle';
    t.textContent = welcomeTitle;
    var s = document.createElement('div');
    s.className = 'wsub';
    s.textContent = welcomeText;
    welcomeHome.appendChild(av);
    welcomeHome.appendChild(t);
    welcomeHome.appendChild(s);
  }

  function startNewConversation() {
    resetChat();
    showScreen('chat');
    hTitle.textContent = 'Nueva conversación';
    hSub.textContent = '';
    // El hero de bienvenida ahora vive en la pantalla de Inicio; aqui vamos
    // directo al selector de modulo.
    // Renderiza la tarjeta al instante (evita el hueco en blanco mientras carga
    // /api/modules) y rellena los modulos especificos cuando lleguen.
    renderModuleCard(state.modules || []);
    if (!state.modules) {
      loadModules().then(function (mods) {
        if (state.screen === 'chat' && !state.started) fillModuleOptions(mods);
      });
    }
  }

  // Re-pinta la lista de opciones del dropdown personalizado (conservando la
  // seleccion actual). Se llama al crear la tarjeta y cuando /api/modules llega.
  function fillModuleOptions(modules) {
    var wrap = modSlot.querySelector('.modsel');
    if (!wrap || !wrap._renderOptions) return;
    wrap._renderOptions(modules);
  }

  function renderModuleCard(modules) {
    modSlot.innerHTML =
      '<div class="modcard">' +
        '<h3>Módulo de la consulta</h3>' +
        '<p>Para darte la mejor respuesta, elige el módulo con el que necesitas ayuda. Luego escribe tu pregunta.</p>' +
        '<label>Módulo</label>' +
        '<div class="modsel">' +
          '<button type="button" class="modsel-btn" aria-haspopup="listbox">' +
            '<span class="modsel-label">Todos los módulos</span>' +
            '<span class="modsel-arrow">' + ICONS.chevron + '</span>' +
          '</button>' +
          '<div class="modsel-list" role="listbox"></div>' +
        '</div>' +
        '<div class="row"><button class="next">Siguiente</button></div>' +
      '</div>';

    var wrap = modSlot.querySelector('.modsel');
    var btn = wrap.querySelector('.modsel-btn');
    var labelEl = wrap.querySelector('.modsel-label');
    var list = wrap.querySelector('.modsel-list');
    // Seleccion actual del dropdown ("" = todos los modulos).
    var selected = { id: '', label: 'Todos los módulos' };

    function closeList() { wrap.classList.remove('open'); }

    // Reconstruye las opciones: siempre "Todos los modulos" + los del manual.
    wrap._renderOptions = function (mods) {
      list.innerHTML = '';
      var all = [{ id: '', label: 'Todos los módulos' }].concat(mods || []);
      all.forEach(function (m) {
        var o = document.createElement('button');
        o.type = 'button';
        o.className = 'modsel-opt' + (m.id === selected.id ? ' sel' : '');
        o.setAttribute('role', 'option');
        o.textContent = m.label;
        o.addEventListener('click', function () {
          selected = { id: m.id, label: m.label };
          labelEl.textContent = m.label;
          list.querySelectorAll('.modsel-opt').forEach(function (x) { x.classList.remove('sel'); });
          o.classList.add('sel');
          closeList();
        });
        list.appendChild(o);
      });
    };
    wrap._getSelected = function () { return selected; };

    btn.addEventListener('click', function (e) {
      e.stopPropagation(); // evita que el listener global lo cierre al instante
      wrap.classList.toggle('open');
    });

    wrap._renderOptions(modules);

    modSlot.querySelector('.next').addEventListener('click', function () {
      var s = wrap._getSelected();
      state.moduleId = s.id || null;
      state.moduleLabel = s.id ? s.label : null;
      state.started = true;
      modSlot.innerHTML = '';
      var label = state.moduleLabel || 'todos los módulos';
      addBot('Perfecto 👍 Cuéntame tu duda sobre ' + label + '.');
      composer.classList.remove('hidden');
      textarea.focus();
    });
  }

  function openConversation(c) {
    resetChat();
    showScreen('chat');
    state.conversationId = c.id;
    state.moduleId = c.module || null;
    state.moduleLabel = c.module_label || null;
    state.started = true;
    hTitle.textContent = c.title || 'Conversación';
    hSub.textContent = fmtDate(c.updated_at);
    composer.classList.remove('hidden');
    messages.innerHTML = '<div class="empty">Cargando...</div>';
    api('/api/conversations/' + c.id + '?userId=' + encodeURIComponent(userId), {})
      .then(function (d) {
        messages.innerHTML = '';
        (d.messages || []).forEach(function (m) {
          if (m.role === 'user') addUser(m.content);
          else addBot(m.content, m.sources);
        });
      })
      .catch(function () {
        messages.innerHTML = '<div class="empty">No se pudo cargar la conversación.</div>';
      });
  }

  function scrollDown() { $('.body').scrollTop = $('.body').scrollHeight; }

  function addUser(text) {
    var el = document.createElement('div');
    el.className = 'msg user';
    var b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    el.appendChild(b);
    messages.appendChild(el);
    scrollDown();
  }

  function addBot(text, sources, options) {
    var el = document.createElement('div');
    el.className = 'msg bot';
    var b = document.createElement('div');
    b.className = 'bubble';
    var content = document.createElement('div');
    content.className = 'md';
    content.innerHTML = renderMarkdown(text);
    b.appendChild(content);
    // Opciones de clarificacion: botones que, al pulsarse, se envian como la
    // siguiente pregunta. Se deshabilitan una vez elegida una para evitar
    // dobles envios.
    if (options && options.length) {
      var opts = document.createElement('div');
      opts.className = 'options';
      options.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.className = 'opt';
        btn.textContent = opt;
        btn.addEventListener('click', function () {
          opts.classList.add('done');
          submitQuestion(opt);
        });
        opts.appendChild(btn);
      });
      b.appendChild(opts);
    }
    if (sources && sources.length) {
      var s = document.createElement('div');
      s.className = 'sources';
      var lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = 'Fuentes:';
      s.appendChild(lbl);
      sources.forEach(function (src) {
        var a = document.createElement('a');
        a.href = src.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = src.title || src.url;
        s.appendChild(a);
      });
      b.appendChild(s);
    }
    el.appendChild(b);
    messages.appendChild(el);
    scrollDown();
    return el;
  }

  function addTyping() {
    var el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = '<div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>';
    messages.appendChild(el);
    scrollDown();
    return el;
  }

  function setBusy(busy) {
    state.busy = busy;
    sendBtn.disabled = busy;
    textarea.disabled = busy;
  }

  // Envia desde el textarea (Enter o boton "Enviar").
  function send() {
    var q = textarea.value.trim();
    if (!q || state.busy) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    submitQuestion(q);
  }

  // Envia una pregunta al backend. Lo usan tanto el textarea como los botones
  // de opciones de clarificacion.
  function submitQuestion(q) {
    q = (q || '').trim();
    if (!q || state.busy) return;
    addUser(q);
    setBusy(true);
    var typing = addTyping();

    api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        moduleId: state.moduleId,
        moduleLabel: state.moduleLabel,
        manualIndex: manualIndex || null,
        conversationId: state.conversationId,
        userId: userId,
        userName: userName,
      }),
    })
      .then(function (data) {
        typing.remove();
        state.conversationId = data.conversationId || state.conversationId;
        state.convosDirty = true; // la lista de conversaciones cambio
        addBot(data.answer || 'Sin respuesta.', data.sources, data.options);
      })
      .catch(function () {
        typing.remove();
        addBot('No se pudo conectar con el asistente. Revisa tu conexión e intenta de nuevo.');
      })
      .finally(function () {
        setBusy(false);
        textarea.focus();
      });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Formato en linea: escapa HTML primero (seguro contra inyeccion) y luego
  // convierte codigo, enlaces, negritas y cursivas de Markdown.
  function mdInline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    return s;
  }

  // Mini-renderer de Markdown por bloques: encabezados, listas ordenadas y con
  // vinetas, bloques de codigo, citas, separadores y parrafos. Es intencionalmente
  // pequeno; NO usa innerHTML sin escapar (todo pasa por escapeHtml en mdInline).
  function renderMarkdown(src) {
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');

    // Protege bloques de codigo ``` ``` antes de procesar por linea.
    var codeBlocks = [];
    text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, function (_, code) {
      codeBlocks.push(code.replace(/\n$/, ''));
      return ' C' + (codeBlocks.length - 1) + ' ';
    });

    var lines = text.split('\n');
    var html = '';
    var i = 0;
    var UL = /^\s*[-*+]\s+/, OL = /^\s*\d+[.)]\s+/, BLANK = /^\s*$/;

    while (i < lines.length) {
      var line = lines[i];

      if (BLANK.test(line)) { i++; continue; }

      var cm = line.match(/^ C(\d+) \s*$/);
      if (cm) { html += '<pre><code>' + escapeHtml(codeBlocks[+cm[1]]) + '</code></pre>'; i++; continue; }

      var hr = /^\s*([-*_])\1\1+\s*$/;
      if (hr.test(line)) { html += '<hr>'; i++; continue; }

      var hm = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (hm) {
        var lvl = Math.min(hm[1].length, 6);
        html += '<h' + lvl + '>' + mdInline(hm[2].trim()) + '</h' + lvl + '>';
        i++; continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        html += '<blockquote>' + mdInline(quote.join('\n')).replace(/\n/g, '<br>') + '</blockquote>';
        continue;
      }

      if (OL.test(line) || UL.test(line)) {
        var ordered = OL.test(line);
        var re = ordered ? OL : UL;
        html += ordered ? '<ol>' : '<ul>';
        while (i < lines.length) {
          if (re.test(lines[i])) {
            var item = lines[i].replace(re, '');
            i++;
            // Continuacion: lineas sueltas bajo el item (descripcion que sigue en
            // la linea siguiente) se agregan al mismo <li> en vez de partir la lista.
            while (i < lines.length && !BLANK.test(lines[i]) && !UL.test(lines[i])
                && !OL.test(lines[i]) && !/^\s*(#{1,6})\s+/.test(lines[i])
                && !/^\s*>\s?/.test(lines[i]) && !/^ C\d+ \s*$/.test(lines[i])) {
              item += '\n' + lines[i]; i++;
            }
            html += '<li>' + mdInline(item).replace(/\n/g, '<br>') + '</li>';
          } else if (BLANK.test(lines[i]) && lines[i + 1]
              && (OL.test(lines[i + 1]) || UL.test(lines[i + 1]))) {
            i++; // linea en blanco entre items
          } else break;
        }
        html += ordered ? '</ol>' : '</ul>';
        continue;
      }

      // Parrafo: junta lineas consecutivas que no abran otro bloque.
      var para = [];
      while (i < lines.length && !BLANK.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i])
          && !/^\s*(#{1,6})\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])
          && !/^ C\d+ \s*$/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (para.length) html += '<p>' + mdInline(para.join('\n')).replace(/\n/g, '<br>') + '</p>';
    }

    return html;
  }

  // --- Eventos ---------------------------------------------------------------
  function togglePanel(open) {
    var show = open === undefined ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', show);
    if (show) {
      // Precarga los modulos apenas se abre el widget para que ya esten en
      // cache (state.modules) al entrar a "Nueva conversacion". Evita que el
      // selector aparezca solo con "Todos los modulos" la primera vez.
      loadModules();
      if (state.screen === 'home') renderMenu();
    }
  }

  fab.addEventListener('click', function () { togglePanel(); });
  closeBtn.addEventListener('click', function () { togglePanel(false); });
  backBtn.addEventListener('click', function () { showScreen('home'); });

  navHome.addEventListener('click', function () { showScreen('home'); renderMenu(); });
  navConvos.addEventListener('click', openConversations);
  navArticles.addEventListener('click', function () {
    if (docsUrl) window.open(docsUrl, '_blank', 'noopener');
    else openConversations();
  });

  newConvoBtn.addEventListener('click', startNewConversation);

  // Cierra el dropdown de modulo al hacer clic fuera de el (el boton del propio
  // dropdown detiene la propagacion, asi que abrirlo no lo cierra al instante).
  root.addEventListener('click', function (e) {
    var openSel = root.querySelector('.modsel.open');
    if (openSel && !openSel.contains(e.target)) openSel.classList.remove('open');
  });

  sendBtn.addEventListener('click', send);
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  textarea.addEventListener('input', function () {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
  });

  // Estado inicial.
  renderHomeWelcome();
  renderMenu();
  showScreen('home');
})();
