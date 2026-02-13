/**
 * KaTeX Loader Module
 * 
 * Provides local KaTeX loading for offline-capable math rendering.
 * Uses KaTeX loaded from local vendor files.
 */

(function () {
  'use strict';

  var KATEX_LOADED = false;
  var KATEX_LOADING = false;
  var RENDER_QUEUE = [];

  /**
   * Initialize KaTeX by loading the JS library
   */
  function initKaTeX() {
    if (KATEX_LOADED || KATEX_LOADING) {
      return KATEX_LOADED ? Promise.resolve() : new Promise(function(resolve) {
        RENDER_QUEUE.push({ type: 'resolve', fn: resolve });
      });
    }

    KATEX_LOADING = true;

    return new Promise(function (resolve, reject) {
      // Check if KaTeX is already loaded
      if (window.katex) {
        KATEX_LOADED = true;
        KATEX_LOADING = false;
        processRenderQueue();
        resolve();
        return;
      }

      // Load KaTeX from vendor
      var script = document.createElement('script');
      script.src = 'js/vendor/katex.min.js';
      script.async = true;
      
      script.onload = function () {
        KATEX_LOADED = true;
        KATEX_LOADING = false;
        processRenderQueue();
        resolve();
      };
      
      script.onerror = function (err) {
        KATEX_LOADING = false;
        console.error('Failed to load KaTeX:', err);
        reject(new Error('KaTeX failed to load'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Process any queued render requests
   */
  function processRenderQueue() {
    while (RENDER_QUEUE.length > 0) {
      var item = RENDER_QUEUE.shift();
      if (item.type === 'resolve') {
        item.fn();
      } else if (item.type === 'render') {
        renderMathInElement(item.element, item.options);
      }
    }
  }

  /**
   * Render math in a DOM element
   */
  function renderMathInElement(element, options) {
    if (!KATEX_LOADED) {
      RENDER_QUEUE.push({ type: 'render', element: element, options: options });
      initKaTeX();
      return;
    }

    var defaultOptions = {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false,
      errorColor: '#cc0000',
      trust: true,
      strict: false,
      macros: {
        '\\RR': '\\mathbb{R}',
        '\\NN': '\\mathbb{N}',
        '\\ZZ': '\\mathbb{Z}',
        '\\QQ': '\\mathbb{Q}',
        '\\CC': '\\mathbb{C}'
      }
    };

    var opts = Object.assign({}, defaultOptions, options || {});

    // Handle display vs inline math
    if (element.tagName === 'D-MATH') {
      var isBlock = element.hasAttribute('block');
      var mathText = element.textContent;
      
      try {
        katex.render(mathText, element, {
          displayMode: isBlock,
          throwOnError: opts.throwOnError,
          errorColor: opts.errorColor,
          trust: opts.trust,
          strict: opts.strict,
          macros: opts.macros
        });
      } catch (e) {
        console.error('KaTeX render error:', e);
        element.textContent = mathText;
        element.style.color = opts.errorColor;
      }
      return;
    }

    // Auto-render delimiters in regular elements
    if (typeof katex !== 'undefined' && katex.autoRender) {
      katex.autoRender(element, opts);
    }
  }

  /**
   * Find and render all math elements on the page
   */
  function renderAllMath() {
    // Render d-math elements
    var mathElements = document.querySelectorAll('d-math');
    mathElements.forEach(function (el) {
      renderMathInElement(el);
    });

    // Auto-render in d-article
    var article = document.querySelector('d-article');
    if (article && typeof katex !== 'undefined' && katex.autoRender) {
      katex.autoRender(article, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        errorColor: '#cc0000'
      });
    }
  }

  /**
   * Handle theme changes for KaTeX
   */
  function handleThemeChange(theme) {
    // KaTeX handles theming via CSS, ensure proper class is applied
    var html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('katex-dark');
    } else {
      html.classList.remove('katex-dark');
    }
  }

  // Expose public API
  window.KaTeXLoader = {
    init: initKaTeX,
    render: renderMathInElement,
    renderAll: renderAllMath,
    onThemeChange: handleThemeChange,
    isLoaded: function () { return KATEX_LOADED; }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initKaTeX().then(function () {
        renderAllMath();
      });
    });
  } else {
    initKaTeX().then(function () {
      renderAllMath();
    });
  }

})();
