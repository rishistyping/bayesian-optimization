(function () {
  var ACTIVE_CLASS = "cursor-enhanced";
  var BASE_CURSOR_SIZE = 24;
  var CHIP_PADDING = 10;
  var PILL_PADDING = 18;
  var LABEL_OFFSET_X = 14;
  var LABEL_OFFSET_Y = 8;
  var SMOOTHING_FACTOR = 0.22;

  var NATIVE_SELECTOR = "input, textarea, select, input[type='range'], [contenteditable], [contenteditable='true']";
  var CHIP_SELECTOR = "button, .replay-step-btn, .cp-tab, .prediction-btn, #cp-sim-start, #cp-sim-stop";
  var DEFAULT_SELECTOR = "a, .chapter-nav-link, .chapter-contents-list a";
  var CUSTOM_SELECTOR = "[data-cursor-style], [data-cursor-label], [data-cursor-checked]";

  var LABEL_IDS = {
    "replay-play": true,
    "replay-prev": true,
    "replay-next": true,
    "cp-sim-start": true,
    "cp-sim-stop": true,
    "reset-state": true
  };

  var pointerFineQuery = window.matchMedia ? window.matchMedia("(pointer: fine)") : null;
  var reducedMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var root = document.documentElement;
  var body = document.body;
  var PASSIVE = { passive: true };

  var state = {
    enabled: false,
    reducedMotion: false,
    pointerSeen: false,
    visible: false,
    pressed: false,
    activeStyle: "default",
    activeEl: null,
    activeLabel: "",
    activeChecked: false,
    pointerX: 0,
    pointerY: 0,
    targetX: 0,
    targetY: 0,
    targetW: BASE_CURSOR_SIZE,
    targetH: BASE_CURSOR_SIZE,
    currentX: 0,
    currentY: 0,
    currentW: BASE_CURSOR_SIZE,
    currentH: BASE_CURSOR_SIZE,
    hasCurrent: false,
    rafId: null,
    cursorEl: null,
    labelEl: null
  };

  function isFinePointer() {
    return !!(pointerFineQuery && pointerFineQuery.matches);
  }

  function isReducedMotion() {
    return !!(reducedMotionQuery && reducedMotionQuery.matches);
  }

  function trimText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sanitizeStyle(value) {
    var raw = trimText(value).toLowerCase();
    if (raw === "chip" || raw === "pill" || raw === "hidden" || raw === "native" || raw === "default") {
      return raw;
    }
    return "default";
  }

  function closestElement(node) {
    if (!node) {
      return null;
    }
    if (node.nodeType === 1) {
      return node;
    }
    return node.parentElement || null;
  }

  function safeClosest(start, selector) {
    if (!start || !selector || typeof start.closest !== "function") {
      return null;
    }
    return start.closest(selector);
  }

  function resolveLabel(element) {
    if (!element) {
      return "";
    }

    var explicit = safeClosest(element, "[data-cursor-label]");
    if (explicit) {
      return trimText(explicit.getAttribute("data-cursor-label"));
    }

    if (LABEL_IDS[element.id]) {
      return trimText(element.getAttribute("aria-label") || element.textContent);
    }

    return "";
  }

  function resolveChecked(element) {
    if (!element) {
      return false;
    }
    var checkedNode = safeClosest(element, "[data-cursor-checked]");
    if (!checkedNode) {
      return false;
    }
    return String(checkedNode.getAttribute("data-cursor-checked")).toLowerCase() === "true";
  }

  function resolveTarget(node) {
    var element = closestElement(node);
    if (!element) {
      return { element: null, style: "default", label: "", checked: false };
    }

    var styleNode = safeClosest(element, CUSTOM_SELECTOR);
    var style = "default";
    var target = null;

    if (styleNode && styleNode.hasAttribute("data-cursor-style")) {
      style = sanitizeStyle(styleNode.getAttribute("data-cursor-style"));
      target = styleNode;
    } else {
      var nativeNode = safeClosest(element, NATIVE_SELECTOR);
      var chipNode = safeClosest(element, CHIP_SELECTOR);
      var defaultNode = safeClosest(element, DEFAULT_SELECTOR);

      if (nativeNode) {
        style = "native";
        target = nativeNode;
      } else if (chipNode) {
        style = "chip";
        target = chipNode;
      } else if (defaultNode) {
        style = "default";
        target = defaultNode;
      }
    }

    return {
      element: target,
      style: style,
      label: resolveLabel(target),
      checked: resolveChecked(target)
    };
  }

  function ensureLayers() {
    if (state.cursorEl && state.labelEl) {
      return;
    }

    var cursorEl = document.createElement("div");
    cursorEl.className = "gd-cursor is-hidden";
    cursorEl.setAttribute("aria-hidden", "true");

    var labelEl = document.createElement("div");
    labelEl.className = "gd-cursor-label";
    labelEl.setAttribute("aria-hidden", "true");

    body.appendChild(cursorEl);
    body.appendChild(labelEl);

    state.cursorEl = cursorEl;
    state.labelEl = labelEl;
  }

  function destroyLayers() {
    if (state.cursorEl && state.cursorEl.parentNode) {
      state.cursorEl.parentNode.removeChild(state.cursorEl);
    }
    if (state.labelEl && state.labelEl.parentNode) {
      state.labelEl.parentNode.removeChild(state.labelEl);
    }
    state.cursorEl = null;
    state.labelEl = null;
  }

  function syncTargetGeometry() {
    if (!state.activeEl || (state.activeStyle !== "chip" && state.activeStyle !== "pill")) {
      state.targetX = state.pointerX;
      state.targetY = state.pointerY;
      state.targetW = BASE_CURSOR_SIZE;
      state.targetH = BASE_CURSOR_SIZE;
      return;
    }

    var rect = state.activeEl.getBoundingClientRect();
    var padding = state.activeStyle === "pill" ? PILL_PADDING : CHIP_PADDING;
    state.targetX = rect.left + rect.width / 2;
    state.targetY = rect.top + rect.height / 2;
    state.targetW = Math.max(BASE_CURSOR_SIZE, rect.width + padding);
    state.targetH = Math.max(BASE_CURSOR_SIZE, rect.height + padding);
  }

  function refreshClasses() {
    if (!state.cursorEl || !state.labelEl) {
      return;
    }

    state.cursorEl.className = "gd-cursor";
    state.labelEl.className = "gd-cursor-label";

    if (state.activeStyle === "chip") {
      state.cursorEl.classList.add("is-active", "is-chip");
    } else if (state.activeStyle === "pill") {
      state.cursorEl.classList.add("is-active", "is-pill");
    } else if (state.activeStyle === "hidden" || state.activeStyle === "native") {
      state.cursorEl.classList.add("is-hidden");
    }

    if (!state.visible) {
      state.cursorEl.classList.add("is-hidden");
    }

    if (state.pressed) {
      state.cursorEl.classList.add("is-pressed");
    }
    if (state.activeChecked) {
      state.cursorEl.classList.add("is-checked");
    }

    if (state.activeLabel && state.activeStyle !== "hidden" && state.activeStyle !== "native" && state.visible) {
      state.labelEl.textContent = state.activeLabel;
      state.labelEl.classList.add("is-active");
    } else {
      state.labelEl.textContent = "";
    }
  }

  function render() {
    if (!state.cursorEl || !state.labelEl) {
      return;
    }

    state.cursorEl.style.width = state.currentW.toFixed(2) + "px";
    state.cursorEl.style.height = state.currentH.toFixed(2) + "px";
    state.cursorEl.style.transform =
      "translate3d(" +
      (state.currentX - state.currentW / 2).toFixed(2) +
      "px," +
      (state.currentY - state.currentH / 2).toFixed(2) +
      "px,0)";

    state.labelEl.style.transform =
      "translate3d(" +
      (state.currentX + Math.max(state.currentW / 2 + LABEL_OFFSET_X, 18)).toFixed(2) +
      "px," +
      (state.currentY - LABEL_OFFSET_Y).toFixed(2) +
      "px,0)";
  }

  function stopFrame() {
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function tick() {
    state.rafId = null;
    if (!state.enabled) {
      return;
    }

    var alpha = state.reducedMotion ? 1 : SMOOTHING_FACTOR;
    var dx = state.targetX - state.currentX;
    var dy = state.targetY - state.currentY;
    var dw = state.targetW - state.currentW;
    var dh = state.targetH - state.currentH;

    state.currentX += dx * alpha;
    state.currentY += dy * alpha;
    state.currentW += dw * alpha;
    state.currentH += dh * alpha;

    render();

    if (
      Math.abs(dx) > 0.25 ||
      Math.abs(dy) > 0.25 ||
      Math.abs(dw) > 0.25 ||
      Math.abs(dh) > 0.25
    ) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function requestFrame() {
    if (state.rafId === null) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function applyResolvedTarget(resolved) {
    state.activeEl = resolved.element;
    state.activeStyle = resolved.style;
    state.activeLabel = resolved.label;
    state.activeChecked = resolved.checked;

    if (state.activeStyle === "native" || state.activeStyle === "hidden") {
      state.visible = false;
    } else if (state.pointerSeen) {
      state.visible = true;
    }

    syncTargetGeometry();
    refreshClasses();
    requestFrame();
  }

  function setDefaultTarget() {
    applyResolvedTarget({
      element: null,
      style: "default",
      label: "",
      checked: false
    });
  }

  function onPointerMove(event) {
    if (!state.enabled || event.pointerType === "touch") {
      return;
    }

    state.pointerSeen = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;

    if (!state.hasCurrent) {
      state.currentX = state.pointerX;
      state.currentY = state.pointerY;
      state.targetX = state.pointerX;
      state.targetY = state.pointerY;
      state.currentW = BASE_CURSOR_SIZE;
      state.currentH = BASE_CURSOR_SIZE;
      state.targetW = BASE_CURSOR_SIZE;
      state.targetH = BASE_CURSOR_SIZE;
      state.hasCurrent = true;
      state.visible = true;
      refreshClasses();
    }

    if (!state.activeEl || state.activeStyle === "default") {
      state.targetX = state.pointerX;
      state.targetY = state.pointerY;
      state.targetW = BASE_CURSOR_SIZE;
      state.targetH = BASE_CURSOR_SIZE;
      state.visible = true;
      refreshClasses();
    }

    requestFrame();
  }

  function onPointerOver(event) {
    if (!state.enabled) {
      return;
    }
    applyResolvedTarget(resolveTarget(event.target));
  }

  function onPointerOut(event) {
    if (!state.enabled) {
      return;
    }
    if (!event.relatedTarget) {
      state.visible = false;
      refreshClasses();
      return;
    }
    applyResolvedTarget(resolveTarget(event.relatedTarget));
  }

  function onPointerDown() {
    if (!state.enabled) {
      return;
    }
    state.pressed = true;
    refreshClasses();
    requestFrame();
  }

  function onPointerUp() {
    if (!state.enabled) {
      return;
    }
    state.pressed = false;
    refreshClasses();
    requestFrame();
  }

  function onScrollOrResize() {
    if (!state.enabled) {
      return;
    }
    syncTargetGeometry();
    requestFrame();
  }

  function onVisibilityChange() {
    if (!state.enabled) {
      return;
    }
    if (document.hidden) {
      state.visible = false;
      refreshClasses();
      stopFrame();
      return;
    }
    if (state.pointerSeen && state.activeStyle !== "native" && state.activeStyle !== "hidden") {
      state.visible = true;
      refreshClasses();
      requestFrame();
    }
  }

  function onBlur() {
    if (!state.enabled) {
      return;
    }
    state.visible = false;
    refreshClasses();
  }

  function onFocus() {
    if (!state.enabled) {
      return;
    }
    if (state.pointerSeen && state.activeStyle !== "native" && state.activeStyle !== "hidden") {
      state.visible = true;
      refreshClasses();
      requestFrame();
    }
  }

  function bindListeners() {
    document.addEventListener("pointermove", onPointerMove, PASSIVE);
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("scroll", onScrollOrResize, PASSIVE);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
  }

  function unbindListeners() {
    document.removeEventListener("pointermove", onPointerMove, PASSIVE);
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("pointerout", onPointerOut, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("scroll", onScrollOrResize, PASSIVE);
    window.removeEventListener("resize", onScrollOrResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
  }

  function resetState() {
    state.pointerSeen = false;
    state.visible = false;
    state.pressed = false;
    state.activeStyle = "default";
    state.activeEl = null;
    state.activeLabel = "";
    state.activeChecked = false;
    state.hasCurrent = false;
    state.pointerX = 0;
    state.pointerY = 0;
    state.targetX = 0;
    state.targetY = 0;
    state.targetW = BASE_CURSOR_SIZE;
    state.targetH = BASE_CURSOR_SIZE;
    state.currentX = 0;
    state.currentY = 0;
    state.currentW = BASE_CURSOR_SIZE;
    state.currentH = BASE_CURSOR_SIZE;
  }

  function enable() {
    if (state.enabled) {
      return;
    }

    state.enabled = true;
    state.reducedMotion = isReducedMotion();
    root.classList.add(ACTIVE_CLASS);
    ensureLayers();
    bindListeners();
    setDefaultTarget();
  }

  function disable() {
    if (!state.enabled) {
      return;
    }

    state.enabled = false;
    root.classList.remove(ACTIVE_CLASS);
    unbindListeners();
    stopFrame();
    destroyLayers();
    resetState();
  }

  function syncEnvironment() {
    state.reducedMotion = isReducedMotion();
    if (!isFinePointer()) {
      disable();
      return;
    }
    enable();
    refreshClasses();
    requestFrame();
  }

  function bindMediaListeners() {
    if (pointerFineQuery) {
      if (typeof pointerFineQuery.addEventListener === "function") {
        pointerFineQuery.addEventListener("change", syncEnvironment);
      } else if (typeof pointerFineQuery.addListener === "function") {
        pointerFineQuery.addListener(syncEnvironment);
      }
    }

    if (reducedMotionQuery) {
      if (typeof reducedMotionQuery.addEventListener === "function") {
        reducedMotionQuery.addEventListener("change", syncEnvironment);
      } else if (typeof reducedMotionQuery.addListener === "function") {
        reducedMotionQuery.addListener(syncEnvironment);
      }
    }
  }

  if (!root || !body || !window.matchMedia) {
    return;
  }

  bindMediaListeners();
  syncEnvironment();
})();
