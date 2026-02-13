(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RainConditionalD3 = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  var globalRef =
    typeof window !== "undefined"
      ? window
      : typeof globalThis !== "undefined"
        ? globalThis
        : this;

  var EPS = 1e-9;
  var MIN_DOMAIN_SPAN = 1e-4;
  var DEFAULT_MAX_DROPS = 180;
  var DEFAULT_SPAWN_MS = 70;
  var DROP_RADIUS_PX = 4;
  var DROP_TOTAL_MS = 2500;
  var STOP_DEDUP_EPS_PX = 1;
  var STAGE_SUBSET_MS = 260;
  var STAGE_RENORMALIZE_MS = 360;
  var PERSPECTIVE_CYCLE_MS = 1800;
  var PERSPECTIVE_CYCLE_ORDER = ["universe", "rain", "testimony", "not_rain"];

  function clamp01(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    if (n < 0) {
      return 0;
    }
    if (n > 1) {
      return 1;
    }
    return n;
  }

  function fixed(value, places) {
    return Number(value).toFixed(places);
  }

  function overlapWidth(a, b) {
    var start = Math.max(a.start, b.start);
    var end = Math.min(a.end, b.end);
    return Math.max(0, end - start);
  }

  function perspectiveMeta(key) {
    if (key === "rain") {
      return { label: "Given rain", symbol: "R" };
    }
    if (key === "testimony") {
      return { label: "Given testimony", symbol: "T" };
    }
    if (key === "not_rain") {
      return { label: "Given not rain", symbol: "¬R" };
    }
    return { label: "Universe", symbol: "U" };
  }

  function getIntervals(state) {
    var prior = clamp01(state.prior);
    var tGivenR = clamp01(state.tGivenR);
    var tGivenNotR = clamp01(state.tGivenNotR);
    var pTestimony = prior * tGivenR + (1 - prior) * tGivenNotR;

    return {
      prior: prior,
      tGivenR: tGivenR,
      tGivenNotR: tGivenNotR,
      posterior: clamp01(state.posterior),
      pTestimony: clamp01(pTestimony),
      rain: { key: "rain", start: 0, end: prior },
      testimony: {
        key: "testimony",
        start: clamp01(prior * (1 - tGivenR)),
        end: clamp01(prior + (1 - prior) * tGivenNotR)
      },
      notRain: { key: "not_rain", start: prior, end: 1 }
    };
  }

  function getRawPerspectiveDomain(perspective, intervals) {
    if (perspective === "rain") {
      return { start: intervals.rain.start, end: intervals.rain.end };
    }
    if (perspective === "testimony") {
      return { start: intervals.testimony.start, end: intervals.testimony.end };
    }
    if (perspective === "not_rain") {
      return { start: intervals.notRain.start, end: intervals.notRain.end };
    }
    return { start: 0, end: 1 };
  }

  function normalizeDomain(rawDomain) {
    var rawStart = clamp01(rawDomain.start);
    var rawEnd = clamp01(rawDomain.end);
    if (rawEnd < rawStart) {
      var swap = rawStart;
      rawStart = rawEnd;
      rawEnd = swap;
    }

    if (rawEnd - rawStart < MIN_DOMAIN_SPAN) {
      if (rawEnd >= 1) {
        rawStart = Math.max(0, rawEnd - MIN_DOMAIN_SPAN);
      } else {
        rawEnd = Math.min(1, rawStart + MIN_DOMAIN_SPAN);
      }
    }

    return {
      start: rawStart,
      end: rawEnd,
      widthRaw: Math.max(0, rawDomain.end - rawDomain.start)
    };
  }

  function makeNoopController() {
    return {
      update: function () {},
      setPerspective: function () {},
      setNarrativeStage: function () {},
      setHighlightedEvent: function () {},
      setRunning: function () {},
      setReducedMotion: function () {},
      destroy: function () {}
    };
  }

  function init(rootEl, options) {
    if (!rootEl) {
      return makeNoopController();
    }

    var opts = options || {};
    var d3Ref = globalRef.d3 && typeof globalRef.d3.select === "function" ? globalRef.d3 : null;
    var documentRef = globalRef.document || (typeof document !== "undefined" ? document : null);

    var vizMount = rootEl.querySelector("#cp-viz");
    var fallbackEl = rootEl.querySelector("#cp-fallback");
    var perspectiveTitleEl = rootEl.querySelector("#cp-perspective-title");
    var formulaEl = rootEl.querySelector("#cp-formula");
    var simStartBtn = rootEl.querySelector("#cp-sim-start");
    var simStopBtn = rootEl.querySelector("#cp-sim-stop");
    var simStatusEl = rootEl.querySelector("#cp-sim-status");

    var probEls = {
      rain: {
        label: rootEl.querySelector("#cp-prob-rain-label"),
        fill: rootEl.querySelector("#cp-prob-rain-fill"),
        value: rootEl.querySelector("#cp-prob-rain-value")
      },
      testimony: {
        label: rootEl.querySelector("#cp-prob-testimony-label"),
        fill: rootEl.querySelector("#cp-prob-testimony-fill"),
        value: rootEl.querySelector("#cp-prob-testimony-value")
      },
      not_rain: {
        label: rootEl.querySelector("#cp-prob-not-rain-label"),
        fill: rootEl.querySelector("#cp-prob-not-rain-fill"),
        value: rootEl.querySelector("#cp-prob-not-rain-value")
      }
    };

    var tabButtons = Array.prototype.slice.call(rootEl.querySelectorAll("button[data-cp-perspective]"));

    if (!vizMount || !formulaEl || !d3Ref) {
      if (fallbackEl) {
        fallbackEl.hidden = false;
      }
      if (simStartBtn) {
        simStartBtn.disabled = true;
      }
      if (simStopBtn) {
        simStopBtn.disabled = true;
      }
      return makeNoopController();
    }

    if (fallbackEl) {
      fallbackEl.hidden = true;
    }

    var state = {
      prior: 0.3,
      tGivenR: 0.85,
      tGivenNotR: 0.1,
      posterior: 0.785,
      perspective: "universe",
      userPerspective: "universe",
      narrativeStage: "universe",
      highlight: null,
      reducedMotion: !!opts.reducedMotion,
      runningRequested: false,
      runningBeforeReduced: false,
      runningActual: false,
      inView: true,
      pageVisible: !!(!documentRef || !documentRef.hidden),
      transitionPaused: false,
      maxDrops: Math.max(40, Number(opts.maxDrops) || DEFAULT_MAX_DROPS),
      spawnMs: Math.max(20, Number(opts.spawnMs) || DEFAULT_SPAWN_MS),
      drops: [],
      dropId: 1,
      spawnAccumulator: 0,
      lastTs: null,
      dimensions: null,
      transition: {
        active: false,
        phase: null,
        fromDomain: { start: 0, end: 1 },
        toDomain: { start: 0, end: 1 },
        startedAt: 0
      },
      rawPerspectiveDomain: { start: 0, end: 1 },
      normalizedPerspectiveDomain: { start: 0, end: 1, widthRaw: 1 },
      intervals: null
    };

    var shelfDefs = [
      { key: "rain", label: "Rain (R)", y: 0.16, h: 0.16 },
      { key: "testimony", label: "Testimony says rain (T)", y: 0.42, h: 0.16 },
      { key: "not_rain", label: "Not rain (¬R)", y: 0.68, h: 0.16 }
    ];

    var svg = d3Ref.select(vizMount).append("svg").attr("class", "cp-svg").attr("preserveAspectRatio", "xMidYMid meet");
    var svgDefs = svg.append("defs");
    var clipId = "cp-clip-" + Math.round(Math.random() * 1e9);
    svgDefs.append("clipPath").attr("id", clipId).append("rect");

    var gRoot = svg.append("g");
    var gFocus = gRoot.append("g").attr("class", "cp-focus-window");
    var gMasks = gRoot.append("g").attr("class", "cp-masks");
    var gGrid = gRoot.append("g").attr("class", "cp-grid");
    var gShelves = gRoot.append("g").attr("class", "cp-shelves").attr("clip-path", "url(#" + clipId + ")");
    var gBoundaries = gRoot.append("g").attr("class", "cp-boundaries").attr("clip-path", "url(#" + clipId + ")");
    var gLabels = gRoot.append("g").attr("class", "cp-labels");
    var gBalls = gRoot.append("g").attr("class", "cp-balls").attr("clip-path", "url(#" + clipId + ")");
    var gAxis = gRoot.append("g").attr("class", "cp-axis");

    gFocus.append("rect").attr("class", "cp-focus-track");
    gFocus.append("rect").attr("class", "cp-focus-band");
    gFocus.append("rect").attr("class", "cp-focus-origin");
    gFocus.append("text").attr("class", "cp-focus-label");
    gMasks.append("rect").attr("class", "cp-mask cp-mask-left");
    gMasks.append("rect").attr("class", "cp-mask cp-mask-right");

    var xScale = d3Ref.scaleLinear();
    var xMini = d3Ref.scaleLinear().domain([0, 1]);
    var axisBottom = d3Ref.axisBottom(xScale).ticks(5).tickFormat(d3Ref.format(".2f"));

    var resizeObserver = null;
    var intersectionObserver = null;
    var dropTimer = null;
    var stageTimer = null;
    var stageToken = 0;
    var fallbackResizeHandler = null;
    var visibilityHandler = null;
    var perspectiveCycleTimer = null;
    var perspectiveCycleIndex = 0;

    function formatConditionalLabel(eventSymbol, conditionSymbol) {
      return "P(" + eventSymbol + "|" + conditionSymbol + ")";
    }

    function toEventSymbol(key) {
      if (key === "rain") {
        return "R";
      }
      if (key === "testimony") {
        return "T";
      }
      return "¬R";
    }

    function updateTabState() {
      var activeTabId = "";
      tabButtons.forEach(function (button) {
        var key = button.getAttribute("data-cp-perspective");
        var active = key === state.perspective;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.setAttribute("tabindex", active ? "0" : "-1");
        if (active) {
          activeTabId = button.id || "";
        }
      });
      if (vizMount && activeTabId) {
        vizMount.setAttribute("aria-labelledby", activeTabId);
      }
    }

    function updateSimulationStatusText() {
      if (!simStatusEl) {
        return;
      }

      if (state.reducedMotion) {
        simStatusEl.textContent = "Motion reduced.";
        return;
      }

      if (state.transitionPaused) {
        simStatusEl.textContent = state.narrativeStage === "renormalized" ? "Renormalized sample space." : "Conditioning...";
        return;
      }

      if (!state.runningRequested) {
        simStatusEl.textContent = "Sampling paused.";
        return;
      }

      if (!state.pageVisible) {
        simStatusEl.textContent = "Paused in background tab.";
        return;
      }

      if (!state.inView) {
        simStatusEl.textContent = "Paused off-screen.";
        return;
      }

      if (state.runningActual) {
        simStatusEl.textContent = "Sampling in view.";
        return;
      }

      simStatusEl.textContent = "Ready.";
    }

    function updateSimulationButtons() {
      if (simStartBtn) {
        simStartBtn.disabled = state.reducedMotion || state.runningRequested;
      }
      if (simStopBtn) {
        simStopBtn.disabled = state.reducedMotion || !state.runningRequested;
      }
      updateSimulationStatusText();
    }

    function stopStageTimer() {
      if (!stageTimer) {
        return;
      }
      if (stageTimer.type === "d3" && stageTimer.handle && typeof stageTimer.handle.stop === "function") {
        stageTimer.handle.stop();
      } else if (stageTimer.type === "native") {
        clearTimeout(stageTimer.handle);
      }
      stageTimer = null;
    }

    function scheduleStage(fn, delayMs) {
      stopStageTimer();
      var delay = Math.max(0, Number(delayMs) || 0);
      if (d3Ref && typeof d3Ref.timeout === "function") {
        stageTimer = {
          type: "d3",
          handle: d3Ref.timeout(function () {
            stageTimer = null;
            fn();
          }, delay)
        };
        return;
      }
      stageTimer = {
        type: "native",
        handle: setTimeout(function () {
          stageTimer = null;
          fn();
        }, delay)
      };
    }

    function clearNarrativeTransition() {
      stopStageTimer();
      stageToken += 1;
      state.transition.active = false;
      state.transition.phase = null;
      state.transitionPaused = false;
      state.transition.startedAt = 0;
    }

    function stopTimer() {
      state.runningActual = false;
      state.lastTs = null;
      state.spawnAccumulator = 0;
      if (dropTimer && typeof dropTimer.stop === "function") {
        dropTimer.stop();
      }
      dropTimer = null;
    }

    function isInInterval(x, interval) {
      return x >= interval.start - EPS && x <= interval.end + EPS;
    }

    function getPerspectiveSamplingDomain() {
      if (state.perspective !== "universe" && state.narrativeStage === "subset") {
        return { start: 0, end: 1, width: 1 };
      }
      return {
        start: state.rawPerspectiveDomain.start,
        end: state.rawPerspectiveDomain.end,
        width: Math.max(0, state.rawPerspectiveDomain.end - state.rawPerspectiveDomain.start)
      };
    }

    function getDropEase(progress) {
      var p = clamp01(progress);
      if (d3Ref && typeof d3Ref.easeBounceOut === "function") {
        return d3Ref.easeBounceOut(p);
      }
      if (d3Ref && typeof d3Ref.easeCubicOut === "function") {
        return d3Ref.easeCubicOut(p);
      }
      return p;
    }

    function buildDropStops(u, dims) {
      var stops = [];
      if (!dims || !state.intervals) {
        return stops;
      }

      if (isInInterval(u, state.intervals.rain)) {
        stops.push({
          key: "rain",
          yTargetPx: Math.max(0, dims.rowTop.rain - DROP_RADIUS_PX)
        });
      }
      if (isInInterval(u, state.intervals.testimony)) {
        stops.push({
          key: "testimony",
          yTargetPx: Math.max(0, dims.rowTop.testimony - DROP_RADIUS_PX)
        });
      }
      if (isInInterval(u, state.intervals.notRain)) {
        stops.push({
          key: "not_rain",
          yTargetPx: Math.max(0, dims.rowTop.not_rain - DROP_RADIUS_PX)
        });
      }

      stops.sort(function (a, b) {
        return a.yTargetPx - b.yTargetPx;
      });

      var deduped = [];
      for (var i = 0; i < stops.length; i += 1) {
        var stop = stops[i];
        var prev = deduped.length ? deduped[deduped.length - 1] : null;
        if (!prev || Math.abs(prev.yTargetPx - stop.yTargetPx) > STOP_DEDUP_EPS_PX) {
          deduped.push(stop);
        }
      }

      return deduped;
    }

    function buildDropSegments(stops, dims) {
      if (!dims) {
        return [];
      }
      var bottomY = dims.innerHeight + DROP_RADIUS_PX * 2;
      var points = [{ y: 0, eventKey: null }];

      for (var i = 0; i < stops.length; i += 1) {
        points.push({
          y: stops[i].yTargetPx,
          eventKey: stops[i].key
        });
      }
      points.push({ y: bottomY, eventKey: null });

      var segments = [];
      for (var j = 1; j < points.length; j += 1) {
        var fromY = points[j - 1].y;
        var toY = points[j].y;
        var span = Math.max(0, toY - fromY);
        var ratio = bottomY > EPS ? span / bottomY : 0;
        segments.push({
          fromY: fromY,
          toY: toY,
          eventKey: points[j].eventKey,
          durationMs: Math.max(40, DROP_TOTAL_MS * ratio)
        });
      }
      return segments;
    }

    function stepOneDrop(drop, dt, dims) {
      if (drop.done) {
        return;
      }
      var segment = drop.segments[drop.segmentIndex];
      if (!segment) {
        drop.done = true;
        return;
      }

      drop.segmentProgressMs += dt;
      var progress = segment.durationMs > EPS ? drop.segmentProgressMs / segment.durationMs : 1;
      var eased = getDropEase(progress);
      drop.yPx = segment.fromY + (segment.toY - segment.fromY) * eased;

      if (progress < 1) {
        return;
      }

      drop.yPx = segment.toY;
      if (segment.eventKey && drop.stopHits[segment.eventKey] !== undefined) {
        drop.stopHits[segment.eventKey] = true;
      }
      drop.segmentIndex += 1;
      drop.segmentProgressMs = 0;
      if (drop.segmentIndex >= drop.segments.length) {
        drop.done = true;
      }
    }

    function spawnDrop() {
      var samplingDomain = getPerspectiveSamplingDomain();
      if (samplingDomain.width <= EPS || !state.intervals || !state.dimensions) {
        return;
      }

      var u = samplingDomain.start + Math.random() * samplingDomain.width;
      var stops = buildDropStops(u, state.dimensions);
      var segments = buildDropSegments(stops, state.dimensions);
      state.drops.push({
        id: state.dropId++,
        u: u,
        hitRain: isInInterval(u, state.intervals.rain),
        hitTestimony: isInInterval(u, state.intervals.testimony),
        hitNotRain: isInInterval(u, state.intervals.notRain),
        stops: stops,
        stopHits: {
          rain: false,
          testimony: false,
          not_rain: false
        },
        segments: segments,
        segmentIndex: 0,
        segmentProgressMs: 0,
        yPx: 0,
        done: false
      });
    }

    function dropClass(d) {
      var cls = "cp-ball cp-ball-drop";

      if (d.stopHits.rain) {
        cls += " cp-ball-hit-rain";
      }
      if (d.stopHits.testimony) {
        cls += " cp-ball-hit-testimony";
      }
      if (d.stopHits.not_rain) {
        cls += " cp-ball-hit-not-rain";
      }
      return cls;
    }

    function renderDrops() {
      if (!state.dimensions) {
        return;
      }

      var circles = gBalls.selectAll("circle.cp-ball-drop").data(state.drops, function (d) {
        return d.id;
      });

      circles.exit().remove();

      circles.enter().append("circle")
        .attr("class", "cp-ball cp-ball-drop")
        .attr("r", DROP_RADIUS_PX)
        .merge(circles)
        .attr("class", dropClass)
        .attr("cx", function (d) { return xScale(d.u); })
        .attr("cy", function (d) { return d.yPx; })
        .attr("opacity", function (d) {
          var progress = state.dimensions.innerHeight > EPS ? d.yPx / (state.dimensions.innerHeight + DROP_RADIUS_PX * 2) : 0;
          return Math.max(0.48, 0.9 - progress * 0.38);
        });
    }

    function stepDrops(now) {
      if (!state.runningActual || !state.dimensions) {
        return;
      }

      if (state.lastTs === null) {
        state.lastTs = now;
      }

      var dt = Math.min(64, Math.max(0, now - state.lastTs));
      state.lastTs = now;
      state.spawnAccumulator += dt;

      while (state.spawnAccumulator >= state.spawnMs && state.drops.length < state.maxDrops) {
        spawnDrop();
        state.spawnAccumulator -= state.spawnMs;
      }

      var nextDrops = [];
      for (var i = 0; i < state.drops.length; i += 1) {
        var drop = state.drops[i];
        stepOneDrop(drop, dt, state.dimensions);
        if (!drop.done) {
          nextDrops.push(drop);
        }
      }
      state.drops = nextDrops;
      renderDrops();
    }

    function startTimer() {
      if (state.runningActual || state.reducedMotion) {
        return;
      }
      state.runningActual = true;
      state.lastTs = null;
      dropTimer = d3Ref.timer(stepDrops);
    }

    function refreshRunningState() {
      var shouldRun = !state.reducedMotion && state.runningRequested && state.pageVisible && !state.transitionPaused;
      if (shouldRun) {
        startTimer();
        startPerspectiveCycle();
      } else {
        stopTimer();
        stopPerspectiveCycle();
      }
      updateSimulationButtons();
    }

    function setRunning(nextRunning) {
      state.runningRequested = !!nextRunning;
      refreshRunningState();
    }

    function startPerspectiveCycle() {
      if (perspectiveCycleTimer) {
        return;
      }
      perspectiveCycleIndex = PERSPECTIVE_CYCLE_ORDER.indexOf(state.perspective);
      if (perspectiveCycleIndex < 0) {
        perspectiveCycleIndex = 0;
      }
      perspectiveCycleTimer = setInterval(function () {
        perspectiveCycleIndex = (perspectiveCycleIndex + 1) % PERSPECTIVE_CYCLE_ORDER.length;
        var nextPerspective = PERSPECTIVE_CYCLE_ORDER[perspectiveCycleIndex];
        setPerspective(nextPerspective, { animate: !state.reducedMotion, source: "cycle", mode: "direct" });
      }, PERSPECTIVE_CYCLE_MS);
    }

    function stopPerspectiveCycle() {
      if (perspectiveCycleTimer) {
        clearInterval(perspectiveCycleTimer);
        perspectiveCycleTimer = null;
      }
    }

    function createStaticDrops() {
      if (!state.reducedMotion || !state.dimensions || !state.intervals) {
        gBalls.selectAll("circle.cp-ball-static").remove();
        return;
      }

      var samplingDomain = getPerspectiveSamplingDomain();
      if (samplingDomain.width <= EPS) {
        gBalls.selectAll("circle.cp-ball-static").remove();
        return;
      }

      var staticCount = 24;
      var seed = state.prior * 73.3 + state.tGivenR * 51.2 + state.tGivenNotR * 91.7;
      var points = [];

      for (var i = 0; i < staticCount; i += 1) {
        var a = Math.sin((i + 1) * 12.9898 + seed * 2.17) * 43758.5453;
        var b = Math.sin((i + 1) * 78.233 + seed * 1.13) * 24634.6345;
        var r1 = a - Math.floor(a);
        var r2 = b - Math.floor(b);
        var u = samplingDomain.start + r1 * samplingDomain.width;
        var y = (0.15 + r2 * 0.75) * state.dimensions.innerHeight;

        points.push({
          id: i,
          u: u,
          y: y,
          hitRain: isInInterval(u, state.intervals.rain),
          hitTestimony: isInInterval(u, state.intervals.testimony),
          hitNotRain: isInInterval(u, state.intervals.notRain)
        });
      }

      var nodes = gBalls.selectAll("circle.cp-ball-static").data(points, function (d) {
        return d.id;
      });

      nodes.exit().remove();

      nodes.enter().append("circle")
        .attr("class", "cp-ball cp-ball-static")
        .attr("r", Math.max(2.7, DROP_RADIUS_PX - 0.5))
        .merge(nodes)
        .attr("class", function (d) {
          var cls = "cp-ball cp-ball-static";
          if (d.hitRain) {
            cls += " cp-ball-hit-rain";
          }
          if (d.hitTestimony) {
            cls += " cp-ball-hit-testimony";
          }
          if (d.hitNotRain) {
            cls += " cp-ball-hit-not-rain";
          }
          return cls;
        })
        .attr("cx", function (d) { return xScale(d.u); })
        .attr("cy", function (d) { return d.y; })
        .attr("opacity", 0.72);
    }

    function updateLayout() {
      var rect = vizMount.getBoundingClientRect();
      var width = Math.max(320, Math.round(rect.width || vizMount.clientWidth || 640));
      var height = Math.max(270, Math.round(width * 0.56));
      var margin = { top: 28, right: 12, bottom: 30, left: 12 };

      var innerWidth = Math.max(1, width - margin.left - margin.right);
      var innerHeight = Math.max(1, height - margin.top - margin.bottom);

      state.dimensions = {
        width: width,
        height: height,
        margin: margin,
        innerWidth: innerWidth,
        innerHeight: innerHeight,
        rowTop: {
          rain: innerHeight * shelfDefs[0].y,
          testimony: innerHeight * shelfDefs[1].y,
          not_rain: innerHeight * shelfDefs[2].y
        },
        rowBottom: {
          rain: innerHeight * (shelfDefs[0].y + shelfDefs[0].h),
          testimony: innerHeight * (shelfDefs[1].y + shelfDefs[1].h),
          not_rain: innerHeight * (shelfDefs[2].y + shelfDefs[2].h)
        },
        rowCenter: {
          rain: innerHeight * (shelfDefs[0].y + shelfDefs[0].h * 0.5),
          testimony: innerHeight * (shelfDefs[1].y + shelfDefs[1].h * 0.5),
          not_rain: innerHeight * (shelfDefs[2].y + shelfDefs[2].h * 0.5)
        }
      };

      svg.attr("viewBox", "0 0 " + width + " " + height)
        .attr("width", "100%")
        .attr("height", "100%");

      gRoot.attr("transform", "translate(" + margin.left + "," + margin.top + ")");

      svgDefs.select("#" + clipId + " rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", innerWidth)
        .attr("height", innerHeight);

      gAxis.attr("transform", "translate(0," + innerHeight + ")");

      xMini.range([0, innerWidth]);
    }

    function updateFocusBand(animate, durationMs) {
      var dims = state.dimensions;
      var raw = state.rawPerspectiveDomain;
      var meta = perspectiveMeta(state.perspective);
      var conditioned = state.perspective !== "universe";
      var subsetStage = conditioned && state.narrativeStage === "subset";
      var renormalizedStage = conditioned && state.narrativeStage === "renormalized";
      var rawStartX = xMini(raw.start);
      var rawWidth = Math.max(2, xMini(raw.end) - xMini(raw.start));
      var bandX = renormalizedStage ? 0 : rawStartX;
      var bandW = renormalizedStage ? dims.innerWidth : rawWidth;
      var originOpacity = renormalizedStage ? 1 : 0;
      var labelText = "Sample space: " + meta.label;
      if (subsetStage) {
        labelText = "Conditioning on " + meta.symbol + " (subset in universe)";
      }

      gFocus.select(".cp-focus-track")
        .attr("x", 0)
        .attr("y", -20)
        .attr("width", dims.innerWidth)
        .attr("height", 8);

      var band = gFocus.select(".cp-focus-band");
      var origin = gFocus.select(".cp-focus-origin");
      var label = gFocus.select(".cp-focus-label");
      var motionMs = Math.max(0, Number(durationMs) || STAGE_SUBSET_MS);

      if (animate && !state.reducedMotion) {
        band.interrupt().transition().duration(motionMs)
          .attr("x", bandX)
          .attr("y", -20)
          .attr("width", bandW)
          .attr("height", 8);

        origin.interrupt().transition().duration(motionMs)
          .attr("x", rawStartX)
          .attr("y", -20)
          .attr("width", rawWidth)
          .attr("height", 8)
          .attr("opacity", originOpacity);

        label.interrupt().transition().duration(motionMs)
          .attr("x", Math.min(dims.innerWidth - 80, Math.max(0, bandX)))
          .attr("y", -24);
      } else {
        band
          .attr("x", bandX)
          .attr("y", -20)
          .attr("width", bandW)
          .attr("height", 8);

        origin
          .attr("x", rawStartX)
          .attr("y", -20)
          .attr("width", rawWidth)
          .attr("height", 8)
          .attr("opacity", originOpacity);

        label
          .attr("x", Math.min(dims.innerWidth - 80, Math.max(0, bandX)))
          .attr("y", -24);
      }
      label.text(labelText);
    }

    function updateMasks(animate, durationMs) {
      var dims = state.dimensions;
      var raw = state.rawPerspectiveDomain;
      var conditioned = state.perspective !== "universe";
      var subsetStage = conditioned && state.narrativeStage === "subset";
      var leftW = subsetStage ? Math.max(0, xMini(raw.start)) : 0;
      var rightX = subsetStage ? Math.min(dims.innerWidth, xMini(raw.end)) : dims.innerWidth;
      var rightW = subsetStage ? Math.max(0, dims.innerWidth - rightX) : 0;
      var opacity = subsetStage ? 0.58 : 0;
      var motionMs = Math.max(0, Number(durationMs) || STAGE_SUBSET_MS);

      var leftMask = gMasks.select(".cp-mask-left");
      var rightMask = gMasks.select(".cp-mask-right");

      if (animate && !state.reducedMotion) {
        leftMask.interrupt().transition().duration(motionMs)
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", leftW)
          .attr("height", dims.innerHeight)
          .attr("opacity", opacity);

        rightMask.interrupt().transition().duration(motionMs)
          .attr("x", rightX)
          .attr("y", 0)
          .attr("width", rightW)
          .attr("height", dims.innerHeight)
          .attr("opacity", opacity);
      } else {
        leftMask
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", leftW)
          .attr("height", dims.innerHeight)
          .attr("opacity", opacity);

        rightMask
          .attr("x", rightX)
          .attr("y", 0)
          .attr("width", rightW)
          .attr("height", dims.innerHeight)
          .attr("opacity", opacity);
      }
    }

    function updateGridAndAxis() {
      var dims = state.dimensions;
      var ticks = xScale.ticks(5);
      var defaultFormat = d3Ref.format(".2f");
      var conditioned = state.perspective !== "universe";
      var renormalized = conditioned && state.narrativeStage === "renormalized";
      var raw = state.rawPerspectiveDomain;
      var rawWidth = Math.max(EPS, raw.end - raw.start);

      axisBottom.tickFormat(function (d) {
        if (renormalized) {
          var normalized = clamp01((d - raw.start) / rawWidth);
          return fixed(normalized, 2);
        }
        return defaultFormat(d);
      });

      var lines = gGrid.selectAll("line.cp-grid-line").data(ticks);
      lines.exit().remove();
      lines.enter().append("line").attr("class", "cp-grid-line").merge(lines)
        .attr("x1", function (d) { return xScale(d); })
        .attr("x2", function (d) { return xScale(d); })
        .attr("y1", 0)
        .attr("y2", dims.innerHeight);

      gAxis.call(axisBottom);
    }

    function updateShelves(animate, durationMs) {
      var dims = state.dimensions;
      var intervals = state.intervals;

      var shelfData = [
        {
          key: "rain",
          label: shelfDefs[0].label,
          interval: intervals.rain,
          y: dims.innerHeight * shelfDefs[0].y,
          h: dims.innerHeight * shelfDefs[0].h
        },
        {
          key: "testimony",
          label: shelfDefs[1].label,
          interval: intervals.testimony,
          y: dims.innerHeight * shelfDefs[1].y,
          h: dims.innerHeight * shelfDefs[1].h
        },
        {
          key: "not_rain",
          label: shelfDefs[2].label,
          interval: intervals.notRain,
          y: dims.innerHeight * shelfDefs[2].y,
          h: dims.innerHeight * shelfDefs[2].h
        }
      ];

      var rows = gShelves.selectAll("g.cp-shelf-row").data(shelfData, function (d) { return d.key; });
      rows.exit().remove();

      var rowsEnter = rows.enter().append("g").attr("class", "cp-shelf-row");
      rowsEnter.append("rect").attr("class", "cp-shelf");

      var mergedRows = rowsEnter.merge(rows);

      var rects = mergedRows.select("rect")
        .attr("class", function (d) {
          var cls = "cp-shelf cp-shelf--" + d.key;
          if (state.highlight === d.key) {
            cls += " cp-highlight";
          }
          return cls;
        });

      var motionMs = Math.max(0, Number(durationMs) || STAGE_SUBSET_MS);
      if (animate && !state.reducedMotion) {
        rects.interrupt().transition().duration(motionMs)
          .attr("x", function (d) { return xScale(d.interval.start); })
          .attr("y", function (d) { return d.y; })
          .attr("width", function (d) { return Math.max(1.5, xScale(d.interval.end) - xScale(d.interval.start)); })
          .attr("height", function (d) { return d.h; });
      } else {
        rects
          .attr("x", function (d) { return xScale(d.interval.start); })
          .attr("y", function (d) { return d.y; })
          .attr("width", function (d) { return Math.max(1.5, xScale(d.interval.end) - xScale(d.interval.start)); })
          .attr("height", function (d) { return d.h; });
      }

      var labels = gLabels.selectAll("text.cp-shelf-label").data(shelfData, function (d) { return d.key; });
      labels.exit().remove();
      labels.enter().append("text").attr("class", "cp-shelf-label").merge(labels)
        .attr("x", 4)
        .attr("y", function (d) { return d.y - 6; })
        .text(function (d) { return d.label; });
    }

    function updateBoundaries(animate, durationMs) {
      var dims = state.dimensions;
      var intervals = state.intervals;

      var boundaryData = [
        { key: "prior", x: intervals.prior },
        { key: "t-left", x: intervals.testimony.start },
        { key: "t-right", x: intervals.testimony.end }
      ];

      var marks = gBoundaries.selectAll("line.cp-boundary").data(boundaryData, function (d) { return d.key; });
      marks.exit().remove();
      var merged = marks.enter().append("line").attr("class", function (d) {
        return "cp-boundary cp-boundary--" + d.key;
      }).merge(marks);

      var motionMs = Math.max(0, Number(durationMs) || STAGE_SUBSET_MS);
      if (animate && !state.reducedMotion) {
        merged.interrupt().transition().duration(motionMs)
          .attr("x1", function (d) { return xScale(d.x); })
          .attr("x2", function (d) { return xScale(d.x); })
          .attr("y1", 0)
          .attr("y2", dims.innerHeight);
      } else {
        merged
          .attr("x1", function (d) { return xScale(d.x); })
          .attr("x2", function (d) { return xScale(d.x); })
          .attr("y1", 0)
          .attr("y2", dims.innerHeight);
      }
    }

    function updateReadouts() {
      var rawDomain = state.rawPerspectiveDomain;
      var given = { start: rawDomain.start, end: rawDomain.end };
      var denom = Math.max(0, rawDomain.end - rawDomain.start);
      var conditionMeta = perspectiveMeta(state.perspective);
      var eventIntervals = {
        rain: state.intervals.rain,
        testimony: state.intervals.testimony,
        not_rain: state.intervals.notRain
      };

      if (perspectiveTitleEl) {
        perspectiveTitleEl.textContent = "Current perspective: " + conditionMeta.label;
      }

      ["rain", "testimony", "not_rain"].forEach(function (key) {
        var item = probEls[key];
        if (!item) {
          return;
        }

        var value = null;
        if (denom > EPS) {
          value = overlapWidth(eventIntervals[key], given) / denom;
          value = clamp01(value);
        }

        var eventSymbol = toEventSymbol(key);
        if (item.label) {
          item.label.textContent = formatConditionalLabel(eventSymbol, conditionMeta.symbol);
        }

        if (item.fill) {
          item.fill.style.width = value === null ? "0%" : (value * 100).toFixed(1) + "%";
          item.fill.classList.toggle("is-undefined", value === null);
        }

        if (item.value) {
          item.value.textContent = value === null ? "undefined" : fixed(value, 3);
          item.value.classList.toggle("is-undefined", value === null);
        }
      });

      var rainNumerator = overlapWidth(eventIntervals.rain, given);
      if (denom <= EPS) {
        formulaEl.textContent = "P(R|" + conditionMeta.symbol + ") is undefined (conditioning event probability is near 0).";
      } else {
        formulaEl.textContent =
          "P(R|" + conditionMeta.symbol + ") = |R∩" + conditionMeta.symbol + "| / |" + conditionMeta.symbol + "| = " +
          fixed(rainNumerator, 3) + " / " + fixed(denom, 3) + " = " + fixed(rainNumerator / denom, 3);
      }
    }

    function renderAll(renderOptions) {
      var optsRender =
        typeof renderOptions === "object" && renderOptions !== null
          ? renderOptions
          : { animate: !!renderOptions };
      var animate = !!optsRender.animate;
      var durationMs = Number.isFinite(optsRender.durationMs) ? Math.max(0, optsRender.durationMs) : STAGE_SUBSET_MS;

      updateLayout();

      state.intervals = getIntervals(state);
      state.rawPerspectiveDomain = getRawPerspectiveDomain(state.perspective, state.intervals);
      var displayDomain;
      if (state.perspective !== "universe" && state.narrativeStage === "subset") {
        displayDomain = { start: 0, end: 1, widthRaw: 1 };
      } else if (state.perspective === "universe") {
        displayDomain = { start: 0, end: 1, widthRaw: 1 };
      } else {
        displayDomain = normalizeDomain(state.rawPerspectiveDomain);
      }
      state.normalizedPerspectiveDomain = displayDomain;

      xScale
        .domain([state.normalizedPerspectiveDomain.start, state.normalizedPerspectiveDomain.end])
        .range([0, state.dimensions.innerWidth]);

      updateTabState();
      updateFocusBand(animate, durationMs);
      updateMasks(animate, durationMs);
      updateGridAndAxis();
      updateShelves(animate, durationMs);
      updateBoundaries(animate, durationMs);
      updateReadouts();

      if (state.reducedMotion) {
        stopTimer();
        state.drops = [];
        gBalls.selectAll("circle.cp-ball-drop").remove();
        createStaticDrops();
      } else {
        gBalls.selectAll("circle.cp-ball-static").remove();
      }
    }

    function beginStagedPerspectiveTransition(perspectiveKey, optionsForSet) {
      var optsSet = optionsForSet || {};
      var token = stageToken + 1;
      var nextIntervals = getIntervals(state);
      var targetDomain = getRawPerspectiveDomain(perspectiveKey, nextIntervals);

      clearNarrativeTransition();
      stageToken = token;
      state.transition.active = true;
      state.transition.phase = "subset";
      state.transition.startedAt = performance.now();
      state.transition.fromDomain = { start: 0, end: 1 };
      state.transition.toDomain = {
        start: targetDomain.start,
        end: targetDomain.end
      };
      state.narrativeStage = "subset";
      state.transitionPaused = true;

      if (!state.reducedMotion && simStatusEl) {
        simStatusEl.textContent = "Conditioning...";
      }
      refreshRunningState();
      renderAll({ animate: !!optsSet.animate, durationMs: STAGE_SUBSET_MS });

      scheduleStage(function () {
        if (token !== stageToken || state.perspective !== perspectiveKey) {
          return;
        }
        state.narrativeStage = "renormalized";
        state.transition.phase = "renormalized";
        state.transition.startedAt = performance.now();
        renderAll({ animate: !!optsSet.animate, durationMs: STAGE_RENORMALIZE_MS });
        if (!state.reducedMotion && simStatusEl) {
          simStatusEl.textContent = "Renormalized sample space.";
        }

        scheduleStage(function () {
          if (token !== stageToken || state.perspective !== perspectiveKey) {
            return;
          }
          state.transition.active = false;
          state.transition.phase = null;
          state.transitionPaused = false;
          refreshRunningState();
        }, STAGE_RENORMALIZE_MS);
      }, STAGE_SUBSET_MS);
    }

    function setPerspective(nextPerspective, optionsForSet) {
      var optsSet = optionsForSet || {};
      var valid = ["universe", "rain", "testimony", "not_rain"];
      var key = valid.indexOf(nextPerspective) >= 0 ? nextPerspective : "universe";
      var changed = state.perspective !== key;
      var shouldAnimate = !!optsSet.animate && !state.reducedMotion;
      var mode = optsSet.mode || (optsSet.source === "user" || optsSet.source === "replay" ? "staged" : "direct");

      state.perspective = key;
      if (optsSet.source === "user") {
        state.userPerspective = key;
      }

      if (typeof opts.onPerspectiveChange === "function" && changed) {
        opts.onPerspectiveChange({ perspective: key, source: optsSet.source || "engine" });
      }

      if (key === "universe" || !shouldAnimate || mode === "direct") {
        clearNarrativeTransition();
        state.narrativeStage = key === "universe" ? "universe" : "renormalized";
        renderAll({ animate: shouldAnimate, durationMs: STAGE_RENORMALIZE_MS });
        refreshRunningState();
        return;
      }

      beginStagedPerspectiveTransition(key, optsSet);
    }

    function setNarrativeStage(stage) {
      var valid = stage === "universe" || stage === "subset" || stage === "renormalized";
      if (!valid) {
        return;
      }
      clearNarrativeTransition();
      state.narrativeStage = stage;
      if (stage !== "subset") {
        state.transitionPaused = false;
      }
      refreshRunningState();
      renderAll(false);
    }

    function setHighlightedEvent(eventKey) {
      var valid = eventKey === "rain" || eventKey === "testimony" || eventKey === "not_rain";
      state.highlight = valid ? eventKey : null;
      renderAll(false);
    }

    function setReducedMotion(nextReduced) {
      var reduced = !!nextReduced;
      if (reduced === state.reducedMotion) {
        return;
      }
      clearNarrativeTransition();
      if (reduced) {
        state.runningBeforeReduced = state.runningRequested;
      }
      state.reducedMotion = reduced;
      if (reduced) {
        state.runningRequested = false;
      } else {
        state.runningRequested = state.runningBeforeReduced;
      }
      state.narrativeStage = state.perspective === "universe" ? "universe" : "renormalized";
      refreshRunningState();
      renderAll(false);
    }

    function update(payload) {
      var next = payload || {};
      if (next.prior !== undefined) {
        state.prior = clamp01(next.prior);
      }
      if (next.tGivenR !== undefined) {
        state.tGivenR = clamp01(next.tGivenR);
      }
      if (next.tGivenNotR !== undefined) {
        state.tGivenNotR = clamp01(next.tGivenNotR);
      }

      if (next.posterior !== undefined && Number.isFinite(next.posterior)) {
        state.posterior = clamp01(next.posterior);
      } else {
        var modelPT = state.prior * state.tGivenR + (1 - state.prior) * state.tGivenNotR;
        state.posterior = modelPT > EPS ? clamp01((state.prior * state.tGivenR) / modelPT) : state.prior;
      }

      if (typeof next.reducedMotion === "boolean") {
        setReducedMotion(next.reducedMotion);
      }

      renderAll(false);
    }

    function onTabClick(button) {
      var perspective = button.getAttribute("data-cp-perspective") || "universe";
      if (typeof opts.onUserInteraction === "function") {
        opts.onUserInteraction({ type: "perspective", perspective: perspective });
      }
      stopPerspectiveCycle();
      setPerspective(perspective, { animate: !state.reducedMotion, source: "user", mode: "staged" });
    }

    function onTabKeydown(event, button) {
      var key = event.key;
      if (
        key !== "ArrowRight" &&
        key !== "ArrowLeft" &&
        key !== "ArrowDown" &&
        key !== "ArrowUp" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }
      if (!tabButtons.length) {
        return;
      }

      event.preventDefault();
      var currentIx = tabButtons.indexOf(button);
      if (currentIx < 0) {
        currentIx = 0;
      }

      var nextIx = currentIx;
      if (key === "ArrowRight" || key === "ArrowDown") {
        nextIx = (currentIx + 1) % tabButtons.length;
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        nextIx = (currentIx - 1 + tabButtons.length) % tabButtons.length;
      } else if (key === "Home") {
        nextIx = 0;
      } else if (key === "End") {
        nextIx = tabButtons.length - 1;
      }

      var targetButton = tabButtons[nextIx];
      if (!targetButton) {
        return;
      }
      targetButton.focus();
      onTabClick(targetButton);
    }

    tabButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        onTabClick(button);
      });
      button.addEventListener("keydown", function (event) {
        onTabKeydown(event, button);
      });
    });

    if (simStartBtn) {
      simStartBtn.addEventListener("click", function () {
        if (typeof opts.onUserInteraction === "function") {
          opts.onUserInteraction({ type: "sim-start" });
        }
        setRunning(true);
      });
    }

    if (simStopBtn) {
      simStopBtn.addEventListener("click", function () {
        if (typeof opts.onUserInteraction === "function") {
          opts.onUserInteraction({ type: "sim-stop" });
        }
        setRunning(false);
      });
    }

    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        function (entries) {
          if (!entries || !entries.length) {
            return;
          }
          var entry = entries[entries.length - 1];
          state.inView = !!entry.isIntersecting;
          refreshRunningState();
        },
        { root: null, threshold: 0.05 }
      );
      intersectionObserver.observe(vizMount);
    } else {
      state.inView = true;
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(function () {
        renderAll(false);
      });
      resizeObserver.observe(vizMount);
    } else {
      fallbackResizeHandler = function () {
        renderAll(false);
      };
      globalRef.addEventListener("resize", fallbackResizeHandler);
    }

    if (documentRef && typeof documentRef.addEventListener === "function") {
      visibilityHandler = function () {
        state.pageVisible = !documentRef.hidden;
        refreshRunningState();
      };
      documentRef.addEventListener("visibilitychange", visibilityHandler);
    }

    refreshRunningState();
    updateSimulationButtons();
    renderAll(false);

    return {
      update: update,
      setPerspective: setPerspective,
      setNarrativeStage: setNarrativeStage,
      setHighlightedEvent: setHighlightedEvent,
      setRunning: setRunning,
      setReducedMotion: setReducedMotion,
      getStatus: function () {
        return {
          reducedMotion: !!state.reducedMotion,
          inView: !!state.inView,
          runningRequested: !!state.runningRequested,
          runningActual: !!state.runningActual,
          dropCount: state.drops.length
        };
      },
      destroy: function () {
        clearNarrativeTransition();
        stopTimer();
        stopPerspectiveCycle();
        if (resizeObserver && typeof resizeObserver.disconnect === "function") {
          resizeObserver.disconnect();
        }
        if (intersectionObserver && typeof intersectionObserver.disconnect === "function") {
          intersectionObserver.disconnect();
        }
        if (fallbackResizeHandler) {
          globalRef.removeEventListener("resize", fallbackResizeHandler);
          fallbackResizeHandler = null;
        }
        if (visibilityHandler && documentRef && typeof documentRef.removeEventListener === "function") {
          documentRef.removeEventListener("visibilitychange", visibilityHandler);
          visibilityHandler = null;
        }
      }
    };
  }

  return {
    init: init
  };
});
