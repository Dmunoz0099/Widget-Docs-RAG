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
      --wg-soft: #f6f7fb;
      --wg-text: #1f2333;
      --wg-muted: #6b7280;
      --wg-border: #e6e7ee;
    }
    * { box-sizing: border-box; }

    .fab {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
      width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, var(--wg-header-from), var(--wg-header-to));
      color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.28);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .fab:hover { transform: scale(1.06); }
    .fab svg { width: 26px; height: 26px; }

    .panel {
      position: fixed; bottom: 90px; right: 20px; z-index: 2147483000;
      width: 380px; max-width: calc(100vw - 32px);
      height: 600px; max-height: calc(100vh - 120px);
      background: var(--wg-bg); border-radius: 18px; overflow: hidden;
      box-shadow: 0 16px 48px rgba(0,0,0,.30);
      display: none; flex-direction: column;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: var(--wg-text);
    }
    .panel.open { display: flex; }

    /* --- Header --- */
    .header {
      background: linear-gradient(135deg, var(--wg-header-from), var(--wg-header-to));
      color: #fff; padding: 18px 18px 20px;
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 8px; flex-shrink: 0;
    }
    .header .htext { min-width: 0; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; line-height: 1.2; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: .92; }
    .header .hbtns { display: flex; gap: 4px; align-items: center; }
    .header button {
      background: rgba(255,255,255,.15); border: none; color: #fff; cursor: pointer;
      width: 30px; height: 30px; border-radius: 8px; font-size: 18px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .header button:hover { background: rgba(255,255,255,.28); }
    .header .back { font-size: 20px; }

    /* --- Cuerpo con scroll --- */
    .body { flex: 1; overflow-y: auto; background: var(--wg-soft); }
    .screen { display: none; }
    .screen.active { display: block; }

    /* --- Busqueda (home) --- */
    .search {
      margin: 4px 16px 0; position: relative; z-index: 1;
    }
    .search input {
      width: 100%; border: none; border-radius: 12px; padding: 12px 14px 12px 40px;
      font-size: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.10); outline: none;
      font-family: inherit; color: var(--wg-text);
    }
    .search svg { position: absolute; left: 13px; top: 12px; width: 18px; height: 18px; color: var(--wg-muted); }

    /* --- Menu de opciones (home) --- */
    .menu { padding: 16px; }
    .menu-item {
      display: flex; gap: 14px; align-items: flex-start; width: 100%;
      background: none; border: none; text-align: left; cursor: pointer;
      padding: 16px 8px; border-bottom: 1px solid var(--wg-border);
      font-family: inherit; color: var(--wg-text);
    }
    .menu-item:last-child { border-bottom: none; }
    .menu-item:hover { background: rgba(0,0,0,.02); border-radius: 10px; }
    .menu-item .ic {
      width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--wg-primary) 14%, #fff);
      color: var(--wg-primary);
    }
    .menu-item .ic svg { width: 18px; height: 18px; }
    .menu-item .mtext { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .menu-item .mt { display: block; font-size: 14px; font-weight: 700; line-height: 1.3; }
    .menu-item .md { display: block; font-size: 12.5px; color: var(--wg-muted); line-height: 1.45; }

    /* --- Lista de conversaciones --- */
    .convos { padding: 12px 16px 84px; }
    .convo {
      display: flex; gap: 12px; align-items: flex-start; width: 100%;
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 12px;
      padding: 12px; margin-bottom: 10px; cursor: pointer; text-align: left;
      font-family: inherit; color: var(--wg-text);
    }
    .convo:hover { border-color: var(--wg-primary); }
    .convo .cav {
      width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
      background: var(--wg-accent); color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .convo .cbody { min-width: 0; flex: 1; }
    .convo .ct { font-size: 13.5px; font-weight: 600; }
    .convo .cp { font-size: 12.5px; color: var(--wg-muted); margin-top: 3px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .convo .cmeta { display: flex; gap: 6px; align-items: center; margin-top: 7px; flex-wrap: wrap; }
    .tag {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: color-mix(in srgb, var(--wg-primary) 12%, #fff); color: var(--wg-primary);
    }
    .badge {
      font-size: 11px; padding: 2px 8px; border-radius: 6px;
      background: #eef0f4; color: var(--wg-muted);
    }
    .empty { text-align: center; color: var(--wg-muted); font-size: 13px; padding: 40px 20px; }

    .newconvo-wrap {
      position: absolute; left: 0; right: 0; bottom: 40px; padding: 12px 16px;
      background: linear-gradient(to top, var(--wg-soft) 70%, transparent);
    }
    .newconvo {
      width: 100%; border: none; border-radius: 12px; padding: 13px;
      background: var(--wg-accent); color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; font-family: inherit;
    }
    .newconvo:hover { filter: brightness(1.12); }

    /* --- Chat --- */
    .messages { padding: 16px; }
    .msg { margin-bottom: 12px; display: flex; }
    .msg.user { justify-content: flex-end; }
    .bubble {
      max-width: 85%; padding: 10px 13px; border-radius: 14px; font-size: 14px;
      line-height: 1.45; white-space: pre-wrap; word-wrap: break-word;
    }
    .msg.user .bubble { background: var(--wg-primary); color: #fff; border-bottom-right-radius: 4px; }
    .msg.bot .bubble { background: var(--wg-bg); color: var(--wg-text); border: 1px solid var(--wg-border); border-bottom-left-radius: 4px; }

    .sources { margin-top: 8px; font-size: 12px; }
    .sources .lbl { color: var(--wg-muted); margin-bottom: 4px; }
    .sources a { display: block; color: var(--wg-primary); text-decoration: none; margin-bottom: 2px; }
    .sources a:hover { text-decoration: underline; }

    .typing { display: inline-flex; gap: 4px; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: blink 1.2s infinite; }
    .typing span:nth-child(2) { animation-delay: .2s; }
    .typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

    /* Tarjeta selector de modulo */
    .modcard {
      background: var(--wg-bg); border: 1px solid var(--wg-border); border-radius: 14px;
      padding: 16px; margin: 0 16px 14px;
    }
    .modcard h3 { margin: 0 0 4px; font-size: 14px; }
    .modcard p { margin: 0 0 12px; font-size: 12.5px; color: var(--wg-muted); line-height: 1.4; }
    .modcard label { font-size: 12px; font-weight: 600; display: block; margin-bottom: 6px; }
    .modcard select {
      width: 100%; padding: 10px 12px; border: 1px solid var(--wg-border); border-radius: 10px;
      font-size: 14px; font-family: inherit; background: var(--wg-bg); color: var(--wg-text); outline: none;
    }
    .modcard .row { display: flex; justify-content: flex-end; margin-top: 12px; }
    .modcard .next {
      border: none; background: var(--wg-accent); color: #fff; border-radius: 10px;
      padding: 9px 18px; cursor: pointer; font-size: 14px; font-weight: 600; font-family: inherit;
    }
    .modcard .next:hover { filter: brightness(1.12); }

    /* --- Composer --- */
    .composer { display: flex; padding: 10px; gap: 8px; border-top: 1px solid var(--wg-border); background: var(--wg-bg); flex-shrink: 0; }
    .composer.hidden { display: none; }
    .composer textarea {
      flex: 1; resize: none; border: 1px solid var(--wg-border); border-radius: 10px;
      padding: 10px 12px; font-size: 14px; font-family: inherit; max-height: 96px; outline: none; color: var(--wg-text);
    }
    .composer textarea:focus { border-color: var(--wg-primary); }
    .composer button {
      border: none; background: var(--wg-primary); color: #fff; border-radius: 10px;
      padding: 0 16px; cursor: pointer; font-size: 14px; font-weight: 600;
    }
    .composer button:disabled { opacity: .5; cursor: default; }

    /* --- Nav inferior --- */
    .nav {
      display: flex; border-top: 1px solid var(--wg-border); background: var(--wg-bg); flex-shrink: 0;
    }
    .nav button {
      flex: 1; background: none; border: none; cursor: pointer; padding: 8px 4px 9px;
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      color: var(--wg-muted); font-size: 11px; font-family: inherit;
    }
    .nav button svg { width: 20px; height: 20px; }
    .nav button.active { color: var(--wg-primary); font-weight: 600; }

    @media (max-width: 420px) {
      .panel { right: 8px; bottom: 82px; width: calc(100vw - 16px); height: calc(100vh - 100px); }
      .fab { right: 12px; bottom: 12px; }
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
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
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
    <button class="fab" aria-label="Abrir chat de ayuda">${ICONS.chat}</button>
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
          <div class="search">
            ${ICONS.search}
            <input type="text" placeholder="¿Qué estás buscando?" aria-label="Buscar" />
          </div>
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
          <div class="modcard-slot"></div>
          <div class="messages"></div>
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
      hTitle.textContent = firstName ? '¡Hola ' + firstName + '! 👋' : '¡Hola! 👋';
      hSub.textContent = '¿Cómo te podemos ayudar?';
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

  function startNewConversation() {
    resetChat();
    showScreen('chat');
    hTitle.textContent = 'Nueva conversación';
    hSub.textContent = '';
    loadModules().then(renderModuleCard);
  }

  function renderModuleCard(modules) {
    var options = '<option value="">Todos los módulos</option>';
    (modules || []).forEach(function (m) {
      options += '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.label) + '</option>';
    });
    modSlot.innerHTML =
      '<div class="modcard">' +
        '<h3>Módulo de la consulta</h3>' +
        '<p>Para darte la mejor respuesta, elige el módulo con el que necesitas ayuda. Luego escribe tu pregunta.</p>' +
        '<label>Módulo</label>' +
        '<select class="modsel">' + options + '</select>' +
        '<div class="row"><button class="next">Siguiente</button></div>' +
      '</div>';
    var sel = modSlot.querySelector('.modsel');
    modSlot.querySelector('.next').addEventListener('click', function () {
      state.moduleId = sel.value || null;
      state.moduleLabel = sel.value ? sel.options[sel.selectedIndex].text : null;
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

  function addBot(text, sources) {
    var el = document.createElement('div');
    el.className = 'msg bot';
    var b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
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

  function send() {
    var q = textarea.value.trim();
    if (!q || state.busy) return;
    addUser(q);
    textarea.value = '';
    textarea.style.height = 'auto';
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
        addBot(data.answer || 'Sin respuesta.', data.sources);
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

  // --- Eventos ---------------------------------------------------------------
  function togglePanel(open) {
    var show = open === undefined ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', show);
    if (show && state.screen === 'home') renderMenu();
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

  sendBtn.addEventListener('click', send);
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  textarea.addEventListener('input', function () {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
  });

  // Estado inicial.
  renderMenu();
  showScreen('home');
})();
