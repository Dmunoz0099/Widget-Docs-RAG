/**
 * Widget de chat flotante con RAG. 100% autocontenido.
 * - Se inyecta con una sola linea <script src>.
 * - Aislado con Shadow DOM (no choca con estilos del portal).
 * - Determina la URL del backend desde:
 *     1. atributo data-api-url del <script>, o
 *     2. el origen desde el que se sirvio este widget.js (por defecto).
 *
 * Uso:
 *   <script src="https://TU-BACKEND/widget.js" async></script>
 *   (opcional) <script src="https://TU-BACKEND/widget.js" data-api-url="https://TU-BACKEND" async></script>
 */
(function () {
  'use strict';

  if (window.__docsRagWidgetLoaded) return;
  window.__docsRagWidgetLoaded = true;

  // --- Resolver URL del backend ---------------------------------------------
  var currentScript =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

  var apiUrl =
    (currentScript && currentScript.getAttribute('data-api-url')) ||
    (currentScript && currentScript.src
      ? new URL(currentScript.src).origin
      : window.location.origin);
  apiUrl = apiUrl.replace(/\/$/, '');
  var chatEndpoint = apiUrl + '/api/chat';

  // --- Estilos (dentro del Shadow DOM) --------------------------------------
  var CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .fab {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      background: #2563eb; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease, background .15s ease;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .fab:hover { transform: scale(1.05); background: #1d4ed8; }
    .fab svg { width: 26px; height: 26px; }

    .panel {
      position: fixed; bottom: 88px; right: 20px; z-index: 2147483000;
      width: 370px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.28);
      display: none; flex-direction: column;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: #111827;
    }
    .panel.open { display: flex; }

    .header {
      background: #2563eb; color: #fff; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .header .title { font-size: 15px; font-weight: 600; }
    .header .close { background: none; border: none; color: #fff; cursor: pointer; font-size: 20px; line-height: 1; }

    .messages { flex: 1; overflow-y: auto; padding: 16px; background: #f9fafb; }
    .msg { margin-bottom: 12px; display: flex; }
    .msg.user { justify-content: flex-end; }
    .bubble {
      max-width: 85%; padding: 10px 12px; border-radius: 12px; font-size: 14px;
      line-height: 1.45; white-space: pre-wrap; word-wrap: break-word;
    }
    .msg.user .bubble { background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
    .msg.bot .bubble { background: #fff; color: #111827; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }

    .sources { margin-top: 8px; font-size: 12px; }
    .sources .lbl { color: #6b7280; margin-bottom: 4px; }
    .sources a { display: block; color: #2563eb; text-decoration: none; margin-bottom: 2px; }
    .sources a:hover { text-decoration: underline; }

    .typing { display: inline-flex; gap: 4px; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: blink 1.2s infinite; }
    .typing span:nth-child(2) { animation-delay: .2s; }
    .typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

    .composer { display: flex; padding: 10px; gap: 8px; border-top: 1px solid #e5e7eb; background: #fff; }
    .composer textarea {
      flex: 1; resize: none; border: 1px solid #d1d5db; border-radius: 10px;
      padding: 9px 11px; font-size: 14px; font-family: inherit; max-height: 96px; outline: none;
    }
    .composer textarea:focus { border-color: #2563eb; }
    .composer button {
      border: none; background: #2563eb; color: #fff; border-radius: 10px;
      padding: 0 14px; cursor: pointer; font-size: 14px;
    }
    .composer button:disabled { background: #93c5fd; cursor: default; }

    @media (max-width: 420px) {
      .panel { right: 8px; bottom: 80px; width: calc(100vw - 16px); height: calc(100vh - 100px); }
      .fab { right: 12px; bottom: 12px; }
    }
  `;

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
    <button class="fab" aria-label="Abrir chat de ayuda">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </button>
    <div class="panel" role="dialog" aria-label="Chat de ayuda">
      <div class="header">
        <span class="title">Asistente de ayuda</span>
        <button class="close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="messages"></div>
      <div class="composer">
        <textarea rows="1" placeholder="Escribe tu pregunta..." aria-label="Tu pregunta"></textarea>
        <button class="send">Enviar</button>
      </div>
    </div>
  `;
  root.appendChild(container);

  var fab = root.querySelector('.fab');
  var panel = root.querySelector('.panel');
  var closeBtn = root.querySelector('.close');
  var messages = root.querySelector('.messages');
  var textarea = root.querySelector('textarea');
  var sendBtn = root.querySelector('.send');

  var greeted = false;

  function togglePanel(open) {
    var show = open === undefined ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', show);
    if (show) {
      textarea.focus();
      if (!greeted) {
        greeted = true;
        addBot('Hola 👋 ¿En qué puedo ayudarte? Pregúntame sobre la documentación.');
      }
    }
  }

  fab.addEventListener('click', function () { togglePanel(); });
  closeBtn.addEventListener('click', function () { togglePanel(false); });

  function scrollDown() { messages.scrollTop = messages.scrollHeight; }

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
    sendBtn.disabled = busy;
    textarea.disabled = busy;
  }

  async function send() {
    var q = textarea.value.trim();
    if (!q) return;
    addUser(q);
    textarea.value = '';
    textarea.style.height = 'auto';
    setBusy(true);
    var typing = addTyping();

    try {
      var res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      typing.remove();
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        addBot(err.error || 'Hubo un problema al responder. Intenta de nuevo.');
        return;
      }
      var data = await res.json();
      addBot(data.answer || 'Sin respuesta.', data.sources);
    } catch (e) {
      typing.remove();
      addBot('No se pudo conectar con el asistente. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setBusy(false);
      textarea.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  textarea.addEventListener('input', function () {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
  });
})();
