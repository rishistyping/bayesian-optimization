(function () {
  var DEFAULTS = {
    maxDrops: 320,
    panelMin: 220,
    panelMax: 280,
    strokeBase: 1.1,
    smoothing: 0.12,
    pulseMs: 320
  };

  function clamp01(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    if (numeric < 0) {
      return 0;
    }
    if (numeric > 1) {
      return 1;
    }
    return numeric;
  }

  function clampRange(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function lerp(min, max, t) {
    return min + (max - min) * clamp01(t);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function createNoopController() {
    return {
      setReducedMotion: function () {},
      setTargetParams: function () {},
      pulse: function () {},
      destroy: function () {}
    };
  }

  function init(mountEl, options) {
    if (!mountEl) {
      return createNoopController();
    }

    var d3Ref = window.d3 && typeof window.d3.select === "function" ? window.d3 : null;
    if (!d3Ref || typeof d3Ref.timer !== "function") {
      return createNoopController();
    }

    var opts = Object.assign({}, DEFAULTS, options || {});
    var reducedMotion = false;
    var destroyed = false;
    var documentRef = window.document || (typeof document !== "undefined" ? document : null);
    var pageVisible = !!(!documentRef || !documentRef.hidden);

    var width = 0;
    var height = 0;

    var timer = null;
    var resizeObserver = null;
    var hasWindowResizeListener = false;
    var visibilityHandler = null;
    var lastFrameAt = performance.now();

    var dropId = 0;
    var drops = [];
    var spawnAccumulator = 0;

    var targetParams = {
      m: 0.5,
      u: 0.5,
      e: 0,
      priorMean: 0.5,
      posteriorMean: 0.5
    };

    var currentParams = {
      m: 0.5,
      u: 0.5,
      e: 0,
      priorMean: 0.5,
      posteriorMean: 0.5
    };

    var pulseState = {
      startedAt: 0,
      durationMs: opts.pulseMs,
      strength: 0
    };

    var rootSel = d3Ref.select(mountEl);
    rootSel.selectAll("*").remove();

    var svg = rootSel.append("svg")
      .attr("class", "rain-preview-svg")
      .attr("aria-hidden", "true")
      .attr("role", "presentation")
      .attr("focusable", "false");

    var layer = svg.append("g").attr("class", "rain-preview-layer");
    var bgRect = layer.append("rect").attr("class", "rain-preview-bg");
    var mistRect = layer.append("rect").attr("class", "rain-preview-mist");
    var dropsLayer = layer.append("g").attr("class", "rain-preview-drops");

    function measureViewport() {
      var rect = mountEl.getBoundingClientRect();
      var measuredWidth = rect.width;
      var measuredHeight = rect.height;

      if (!(measuredWidth > 0)) {
        measuredWidth = opts.panelMin;
      }
      if (!(measuredHeight > 0)) {
        measuredHeight = measuredWidth;
      }

      width = Math.max(1, measuredWidth);
      height = Math.max(1, measuredHeight);

      svg.attr("viewBox", "0 0 " + width.toFixed(2) + " " + height.toFixed(2));
      bgRect
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", height);
      mistRect
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", height);
    }

    function computeDerived(params, pulseBoost) {
      var m = clamp01(params.m);
      var u = clamp01(params.u);
      var windNorm = clamp01((clamp01(params.posteriorMean) - clamp01(params.priorMean)) * 2 + 0.5);

      var spawnRate = lerp(2, 70, Math.pow(m, 1.6));
      var baseSpeed = lerp(80, 520, m);
      var streakLen = lerp(6, 22, m);
      var jitter = lerp(0.15, 2.5, u);
      var mistAlpha = lerp(0.0, 0.16, u);
      var windDrift = lerp(-25, 25, windNorm);

      var boost = clamp01(pulseBoost || 0);
      if (boost > 0) {
        spawnRate *= 1 + 0.75 * boost;
        baseSpeed *= 1 + 0.5 * boost;
      }

      return {
        m: m,
        u: u,
        spawnRate: spawnRate,
        baseSpeed: baseSpeed,
        streakLen: streakLen,
        jitter: jitter,
        mistAlpha: mistAlpha,
        windDrift: windDrift
      };
    }

    function currentPulseBoost(nowMs) {
      if (pulseState.strength <= 0 || pulseState.durationMs <= 0) {
        return 0;
      }

      var elapsed = nowMs - pulseState.startedAt;
      if (elapsed >= pulseState.durationMs) {
        pulseState.strength = 0;
        return 0;
      }

      var decay = 1 - elapsed / pulseState.durationMs;
      return pulseState.strength * decay * decay;
    }

    function createDrop(config, fromTop) {
      var jitterScale = config.jitter / 2.5;
      var speed = Math.max(
        40,
        config.baseSpeed * (1 + randomBetween(-0.4, 0.4) * jitterScale)
      );
      var len = Math.max(
        4,
        config.streakLen * (1 + randomBetween(-0.3, 0.3) * jitterScale)
      );
      var drift =
        config.windDrift * (0.55 + Math.random() * 0.35) +
        randomBetween(-10, 10) * jitterScale;

      var tilt = clampRange(drift / 180, -0.42, 0.42);
      var x = randomBetween(-12, width + 12);
      var y = fromTop ? randomBetween(-height * 0.35, -6) : randomBetween(0, height);

      return {
        id: dropId += 1,
        x: x,
        y: y,
        len: len,
        speed: speed,
        drift: drift,
        targetLen: config.streakLen,
        opacity: clampRange(0.12 + 0.5 * config.m + Math.random() * 0.22, 0.08, 0.88),
        strokeW: clampRange(opts.strokeBase * (0.7 + Math.random() * 0.65), 0.7, 2.0),
        tilt: tilt
      };
    }

    function renderDropSelection(nextDrops) {
      var lines = dropsLayer
        .selectAll("line.rain-preview-drop")
        .data(nextDrops, function (d) { return d.id; });

      lines.exit().remove();

      lines.enter()
        .append("line")
        .attr("class", "rain-preview-drop")
        .merge(lines)
        .attr("x1", function (d) { return d.x.toFixed(2); })
        .attr("y1", function (d) { return d.y.toFixed(2); })
        .attr("x2", function (d) { return (d.x + d.tilt * d.len).toFixed(2); })
        .attr("y2", function (d) { return (d.y + d.len).toFixed(2); })
        .attr("opacity", function (d) { return d.opacity.toFixed(3); })
        .attr("stroke-width", function (d) { return d.strokeW.toFixed(3); });
    }

    function renderStaticSnapshot() {
      var m = clamp01(targetParams.m);
      var u = clamp01(targetParams.u);
      var staticCount = Math.round(10 + m * 52);
      var staticDrops = [];
      var config = computeDerived(targetParams, 0);

      mistRect.attr("opacity", lerp(0.0, 0.16, u).toFixed(3));

      for (var i = 0; i < staticCount; i += 1) {
        var drop = createDrop(config, false);
        drop.speed = 0;
        staticDrops.push(drop);
      }

      drops = staticDrops;
      spawnAccumulator = 0;
      renderDropSelection(drops);
    }

    function tickFrame() {
      if (destroyed || reducedMotion) {
        return;
      }

      var now = performance.now();
      var dt = (now - lastFrameAt) / 1000;
      lastFrameAt = now;
      dt = clampRange(dt, 1 / 240, 0.08);

      currentParams.m += (targetParams.m - currentParams.m) * opts.smoothing;
      currentParams.u += (targetParams.u - currentParams.u) * opts.smoothing;
      currentParams.e += (targetParams.e - currentParams.e) * opts.smoothing;
      currentParams.priorMean += (targetParams.priorMean - currentParams.priorMean) * opts.smoothing;
      currentParams.posteriorMean += (targetParams.posteriorMean - currentParams.posteriorMean) * opts.smoothing;

      var pulseBoost = currentPulseBoost(now);
      var config = computeDerived(currentParams, pulseBoost);
      mistRect.attr("opacity", config.mistAlpha.toFixed(3));

      spawnAccumulator += config.spawnRate * dt;
      var spawnCount = Math.floor(spawnAccumulator);
      if (spawnCount > 0) {
        spawnAccumulator -= spawnCount;
      }
      spawnCount = Math.min(spawnCount, 20);

      while (spawnCount > 0 && drops.length < opts.maxDrops) {
        drops.push(createDrop(config, true));
        spawnCount -= 1;
      }

      var survivors = [];
      for (var i = 0; i < drops.length; i += 1) {
        var drop = drops[i];
        drop.drift += (config.windDrift - drop.drift) * 0.04;
        drop.len += (config.streakLen - drop.len) * 0.08;
        drop.tilt = clampRange(drop.drift / 180, -0.42, 0.42);

        drop.x += drop.drift * dt;
        drop.y += drop.speed * dt;

        if (drop.y <= height + drop.len + 8 && drop.x >= -28 && drop.x <= width + 28) {
          survivors.push(drop);
        }
      }

      drops = survivors;
      renderDropSelection(drops);
    }

    function refreshTimerState() {
      if (destroyed) {
        return;
      }
      if (reducedMotion || !pageVisible) {
        stopTimer();
        return;
      }
      startTimer();
    }

    function startTimer() {
      if (destroyed || reducedMotion || !pageVisible || timer) {
        return;
      }
      lastFrameAt = performance.now();
      timer = d3Ref.timer(tickFrame);
    }

    function stopTimer() {
      if (timer && typeof timer.stop === "function") {
        timer.stop();
      }
      timer = null;
    }

    function setReducedMotion(next) {
      reducedMotion = !!next;
      if (reducedMotion) {
        stopTimer();
        renderStaticSnapshot();
      } else {
        refreshTimerState();
      }
    }

    function setTargetParams(nextParams) {
      var next = nextParams || {};
      targetParams.m = clamp01(next.m);
      targetParams.u = clamp01(next.u);
      targetParams.e = clamp01(next.e);
      targetParams.priorMean = clamp01(next.priorMean);
      targetParams.posteriorMean = clamp01(next.posteriorMean);

      if (reducedMotion) {
        renderStaticSnapshot();
      }
    }

    function pulse(type) {
      if (reducedMotion) {
        return;
      }

      var strength = lerp(0, 1, targetParams.e);
      if (type === "strong") {
        strength = clamp01(strength * 1.25);
      }
      if (type === "replay") {
        strength = Math.max(strength, 0.35);
      }
      if (type === "testimony") {
        strength = Math.max(strength, 0.2);
      }

      pulseState.startedAt = performance.now();
      pulseState.durationMs = clampRange(Number(opts.pulseMs) || 320, 250, 450);
      pulseState.strength = clamp01(strength);
    }

    function destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stopTimer();
      if (resizeObserver && typeof resizeObserver.disconnect === "function") {
        resizeObserver.disconnect();
      }
      resizeObserver = null;
      if (hasWindowResizeListener) {
        window.removeEventListener("resize", handleResize);
      }
      hasWindowResizeListener = false;
      if (visibilityHandler && documentRef && typeof documentRef.removeEventListener === "function") {
        documentRef.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      drops = [];
      rootSel.selectAll("*").remove();
    }

    function handleResize() {
      measureViewport();
      if (reducedMotion) {
        renderStaticSnapshot();
      }
    }

    measureViewport();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(function () {
        handleResize();
      });
      resizeObserver.observe(mountEl);
    } else {
      window.addEventListener("resize", handleResize);
      hasWindowResizeListener = true;
    }

    if (documentRef && typeof documentRef.addEventListener === "function") {
      visibilityHandler = function () {
        pageVisible = !documentRef.hidden;
        refreshTimerState();
      };
      documentRef.addEventListener("visibilitychange", visibilityHandler);
    }

    refreshTimerState();

    return {
      setReducedMotion: setReducedMotion,
      setTargetParams: setTargetParams,
      pulse: pulse,
      destroy: destroy
    };
  }

  window.RainPreviewD3 = {
    init: init
  };
})();
