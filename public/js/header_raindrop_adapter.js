(function () {
  var docEl = document.documentElement;
  var header = document.querySelector("d-title.chapter-header");
  var canvas = document.getElementById("header-raindrop-canvas");

  if (!header || !canvas || typeof window.matchMedia !== "function") {
    return;
  }

  var finePointerQuery = window.matchMedia("(pointer: fine)");
  var reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var loaded = false;
  var loading = false;

  function isEligible() {
    return finePointerQuery.matches && !reducedMotionQuery.matches;
  }

  function setCanvasSize() {
    if (loaded) {
      return;
    }
    var rect = header.getBoundingClientRect();
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }

  function setDisabledState(isDisabled) {
    if (isDisabled) {
      docEl.classList.remove("has-header-raindrop");
      docEl.classList.add("header-raindrop-disabled");
      return;
    }
    docEl.classList.remove("header-raindrop-disabled");
  }

  function loadPortScript() {
    if (loaded || loading) {
      return;
    }
    loading = true;
    setCanvasSize();

    var script = document.createElement("script");
    script.src = "js/header_raindrop_port.js";
    script.defer = true;
    script.onload = function () {
      loading = false;
      loaded = true;
      docEl.classList.add("has-header-raindrop");
      docEl.classList.remove("header-raindrop-disabled");
    };
    script.onerror = function () {
      loading = false;
      setDisabledState(true);
    };
    document.head.appendChild(script);
  }

  function syncState() {
    if (!isEligible()) {
      setDisabledState(true);
      return;
    }

    setDisabledState(false);
    if (loaded) {
      docEl.classList.add("has-header-raindrop");
      return;
    }

    loadPortScript();
  }

  function onEligibilityChange() {
    syncState();
  }

  function addMediaListener(query, handler) {
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      return;
    }
    if (typeof query.addListener === "function") {
      query.addListener(handler);
    }
  }

  setCanvasSize();
  syncState();

  addMediaListener(finePointerQuery, onEligibilityChange);
  addMediaListener(reducedMotionQuery, onEligibilityChange);
  window.addEventListener("resize", setCanvasSize);

  if (typeof ResizeObserver === "function") {
    var observer = new ResizeObserver(function () {
      setCanvasSize();
    });
    observer.observe(header);
  }
})();
