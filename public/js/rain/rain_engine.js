(function () {
  var LOCKED_HELP_ID = "controls-locked-note";
  var PARTICLE_COUNT = 320;
  var PARTICLE_DURATION_MS = 520;
  var PARTICLE_RADIUS_PX = 1.9;
  var PARTICLE_JITTER_SCALE = 0.36;
  var BETA_CONCENTRATION = 18;
  var CDF_BINS = 256;
  var SHAPE_EPS = 1e-3;
  var PROB_EPS = 1e-6;
  var DECISION_THRESHOLD = 0.60;
  var REPLAY_STEP_HOLD_MS = { 1: 1000, 2: 1000, 3: 1000, 4: 900 };
  var REPLAY_STEP_HOLD_MS_REDUCED = { 1: 450, 2: 450, 3: 450, 4: 450 };
  var REPLAY_TRANSITION_MS = 420;
  var REPLAY_TRANSITION_MS_REDUCED = 120;
  var REPLAY_PARTICLE_DRIFT_MS = 760;
  var REPLAY_PARTICLE_DRIFT_MS_REDUCED = 0;
  var REPLAY_PROGRESS_TICK_MS = 50;
  var REPLAY_LOOP_GAP_MS = 220;
  var RAIN_PREVIEW_EVIDENCE_BITS = 1.5;
  var RAIN_PREVIEW_LARGE_DELTA = 0.06;

  function percent(value) {
    return (value * 100).toFixed(1) + "%";
  }

  function fixed(value, places) {
    return Number(value).toFixed(places);
  }

  function debounce(fn, waitMs) {
    var timerId = null;
    return function () {
      var args = arguments;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      timerId = setTimeout(function () {
        fn.apply(null, args);
      }, waitMs);
    };
  }

  function approximatelyEqual(a, b, eps) {
    return Math.abs(a - b) <= (eps || 0.005);
  }

  function deriveMoveLabel(state) {
    var delta = Math.abs(state.posterior - state.prior);
    if (delta >= 0.2) {
      return "big move";
    }
    if (delta >= 0.08) {
      return "medium move";
    }
    return "small move";
  }

  function deriveRainPreviewSignals(model) {
    var m = clamp01(model.posterior);
    var u = clamp01((m * (1 - m)) / 0.25);
    var e = clamp01(Math.abs(Number(model.logEvidence) || 0) / RAIN_PREVIEW_EVIDENCE_BITS);

    return {
      m: m,
      u: u,
      e: e,
      priorMean: clamp01(model.prior),
      posteriorMean: m
    };
  }

  function certaintyLabelFromUncertainty(u) {
    var uncertainty = clamp01(u);
    if (uncertainty < 0.34) {
      return "high";
    }
    if (uncertainty < 0.67) {
      return "medium";
    }
    return "low";
  }

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

  function cubicInOut(t) {
    var p = clamp01(t);
    if (p < 0.5) {
      return 4 * p * p * p;
    }
    var q = -2 * p + 2;
    return 1 - (q * q * q) / 2;
  }

  function randomJitter() {
    return Math.random() * 2 - 1;
  }

  function buildBetaCdf(mean, concentration, bins) {
    var m = clamp01(mean);
    m = Math.min(1 - PROB_EPS, Math.max(PROB_EPS, m));

    var shape = Math.max(concentration, SHAPE_EPS);
    var alpha = Math.max(SHAPE_EPS, m * shape);
    var beta = Math.max(SHAPE_EPS, (1 - m) * shape);

    var cdf = new Array(bins + 1);
    var running = 0;
    var step = 1 / bins;

    for (var i = 0; i <= bins; i += 1) {
      var x = i * step;
      var xx = Math.min(1 - PROB_EPS, Math.max(PROB_EPS, x));
      var density = Math.exp((alpha - 1) * Math.log(xx) + (beta - 1) * Math.log(1 - xx));

      if (!Number.isFinite(density) || density < 0) {
        density = 0;
      }

      running += density;
      cdf[i] = running;
    }

    if (running <= PROB_EPS) {
      for (var j = 0; j <= bins; j += 1) {
        cdf[j] = j / bins;
      }
      return cdf;
    }

    for (var k = 0; k <= bins; k += 1) {
      cdf[k] = cdf[k] / running;
    }
    cdf[bins] = 1;
    return cdf;
  }

  function sampleFromCdf(cdf, u) {
    if (!cdf || !cdf.length) {
      return Math.random();
    }

    var target = clamp01(u);
    var lo = 0;
    var hi = cdf.length - 1;

    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (cdf[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    var bins = cdf.length - 1;
    if (lo <= 0) {
      return 0;
    }

    var lowIx = lo - 1;
    var lowCum = cdf[lowIx];
    var highCum = cdf[lo];
    var span = highCum - lowCum;
    var frac = span > PROB_EPS ? (target - lowCum) / span : 0;
    var x = (lowIx + frac) / bins;
    return clamp01(x);
  }

  function samplePosteriorTargets(posterior, count) {
    var safeCount = Math.max(1, Number(count) || 1);
    var cdf = buildBetaCdf(posterior, BETA_CONCENTRATION, CDF_BINS);
    var targets = new Array(safeCount);

    for (var i = 0; i < safeCount; i += 1) {
      targets[i] = sampleFromCdf(cdf, Math.random());
    }
    return targets;
  }

  function createParticles(initialMean, count) {
    var safeCount = Math.max(1, Number(count) || 1);
    var startTargets = samplePosteriorTargets(initialMean, safeCount);
    var particles = new Array(safeCount);

    for (var i = 0; i < safeCount; i += 1) {
      var p = startTargets[i];
      particles[i] = {
        id: i,
        p: p,
        targetP: p,
        yJitter: randomJitter()
      };
    }
    return particles;
  }

  function parseHashNumber(rawValue) {
    if (rawValue === null || rawValue === "") {
      return null;
    }
    var parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  function getInputFromHash() {
    if (!window.location.hash || window.location.hash.length < 2) {
      return null;
    }

    var params = new URLSearchParams(window.location.hash.slice(1));
    var partial = {};
    var hasAny = false;

    var prior = parseHashNumber(params.get("prior"));
    if (prior !== null) {
      partial.prior = prior;
      hasAny = true;
    }

    var tGivenR = parseHashNumber(params.get("tgr"));
    if (tGivenR !== null) {
      partial.tGivenR = tGivenR;
      hasAny = true;
    }

    var tGivenNotR = parseHashNumber(params.get("tgnr"));
    if (tGivenNotR !== null) {
      partial.tGivenNotR = tGivenNotR;
      hasAny = true;
    }

    return hasAny ? partial : null;
  }

  function writeHash(state) {
    var params = new URLSearchParams();
    params.set("prior", fixed(state.prior, 2));
    params.set("tgr", fixed(state.tGivenR, 2));
    params.set("tgnr", fixed(state.tGivenNotR, 2));

    var nextHash = "#" + params.toString();
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }

  function statesMatchPreset(state, preset) {
    return (
      approximatelyEqual(state.prior, preset.prior) &&
      approximatelyEqual(state.tGivenR, preset.tGivenR) &&
      approximatelyEqual(state.tGivenNotR, preset.tGivenNotR)
    );
  }

  function getMatchingPresetKey(state) {
    var presets = window.RainModel.PRESETS;
    var keys = Object.keys(presets);
    for (var i = 0; i < keys.length; i += 1) {
      if (statesMatchPreset(state, presets[keys[i]])) {
        return keys[i];
      }
    }
    return null;
  }

  function updatePresetButtons(buttons, activePresetKey) {
    buttons.forEach(function (button) {
      var key = button.getAttribute("data-preset");
      var isActive = key === activePresetKey;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function toggleDescribedBy(target, token, shouldInclude) {
    if (!target || !token) {
      return;
    }

    var raw = target.getAttribute("aria-describedby") || "";
    var tokens = raw.split(/\s+/).filter(Boolean);
    var ix = tokens.indexOf(token);

    if (shouldInclude && ix === -1) {
      tokens.push(token);
    }

    if (!shouldInclude && ix !== -1) {
      tokens.splice(ix, 1);
    }

    if (tokens.length) {
      target.setAttribute("aria-describedby", tokens.join(" "));
    } else {
      target.removeAttribute("aria-describedby");
    }
  }

  function bindUnlocking(setUnlockStep) {
    var sections = Array.prototype.slice.call(document.querySelectorAll("[data-unlock-step]"));
    if (!sections.length) {
      setUnlockStep(5);
      return;
    }

    if (!("IntersectionObserver" in window)) {
      setUnlockStep(5);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }
          var step = Number(entry.target.getAttribute("data-unlock-step"));
          if (Number.isFinite(step)) {
            setUnlockStep(step);
          }
        });
      },
      {
        rootMargin: "-20% 0px -50% 0px",
        threshold: 0.15
      }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  function applyUnlock(root, unlockStep) {
    var controls = Array.prototype.slice.call(root.querySelectorAll("[data-step]"));

    controls.forEach(function (block) {
      var step = Number(block.getAttribute("data-step"));
      var unlocked = step <= unlockStep;

      block.classList.toggle("is-locked", !unlocked);
      if (unlocked) {
        block.removeAttribute("aria-disabled");
      } else {
        block.setAttribute("aria-disabled", "true");
      }
      toggleDescribedBy(block, LOCKED_HELP_ID, !unlocked);

      if (block.tagName === "FIELDSET" || block.tagName === "BUTTON") {
        block.disabled = !unlocked;
      }

      var descendants = Array.prototype.slice.call(block.querySelectorAll("button, input"));
      descendants.forEach(function (control) {
        control.disabled = !unlocked;
        if (!unlocked) {
          control.setAttribute("aria-disabled", "true");
        } else {
          control.removeAttribute("aria-disabled");
        }
        toggleDescribedBy(control, LOCKED_HELP_ID, !unlocked);
      });
    });
  }

  function initRainEngine(rootId) {
    var root = document.getElementById(rootId);
    if (!root || !window.RainModel) {
      return;
    }

    var priorSlider = root.querySelector("#prior-slider");
    var truthSlider = root.querySelector("#truth-slider");
    var falseSlider = root.querySelector("#false-slider");

    var priorValue = root.querySelector("#prior-value");
    var truthValue = root.querySelector("#truth-value");
    var falseValue = root.querySelector("#false-value");

    var priorBar = root.querySelector("#prior-bar");
    var priorBarValue = root.querySelector("#prior-bar-value");
    var ptBar = root.querySelector("#pt-bar");
    var ptBarValue = root.querySelector("#pt-bar-value");
    var testimonyStrip = root.querySelector("#testimony-strip");
    var posteriorTrack = root.querySelector(".posterior-track");
    var posteriorParticlesSvg = root.querySelector("#posterior-particles");
    var thresholdMarker = root.querySelector("#decision-threshold");
    var posteriorGhost = root.querySelector("#posterior-ghost");
    var posteriorBar = root.querySelector("#posterior-bar");
    var posteriorBarValue = root.querySelector("#posterior-bar-value");

    var summary = root.querySelector("#posterior-live");
    var announcer = root.querySelector("#posterior-live-announcer");

    var advancedPt = root.querySelector("#advanced-pt");
    var advancedNum = root.querySelector("#advanced-num");
    var advancedPost = root.querySelector("#advanced-post");
    var advancedEvidence = root.querySelector("#advanced-evidence");
    var advancedKl = root.querySelector("#advanced-kl");
    var replayPlay = root.querySelector("#replay-play");
    var replayPrev = root.querySelector("#replay-prev");
    var replayNext = root.querySelector("#replay-next");
    var replayStepButtons = Array.prototype.slice.call(root.querySelectorAll("button[data-replay-step]"));
    var replayProgress = root.querySelector("#replay-progress");
    var decisionPanel = root.querySelector("#decision-panel");
    var decisionText = root.querySelector("#decision-text");
    var decisionUmbrella = root.querySelector("#decision-umbrella");
    var decisionThresholdReadout = root.querySelector("#decision-threshold-readout");
    var rainPreviewMount = root.querySelector("#rain-preview");
    var rainPreviewProb = root.querySelector("#rain-preview-prob");
    var rainPreviewCertainty = root.querySelector("#rain-preview-certainty");

    var guessFirst = root.querySelector("#guess-first");
    var revealGuess = root.querySelector("#reveal-guess");
    var intuition = root.querySelector("#intuition-feedback");

    var resetButton = root.querySelector("#reset-state");
    var presetButtons = Array.prototype.slice.call(root.querySelectorAll("button[data-preset]"));
    var d3Ref = window.d3 && typeof window.d3.select === "function" ? window.d3 : null;
    var d3Scheduler = window.d3 && typeof window.d3.timeout === "function" ? window.d3 : null;
    var reduceMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var prefersReducedMotion = !!(reduceMotionQuery && reduceMotionQuery.matches);
    var rainPreview = null;
    var particleRafId = null;
    var particles = [];
    var particleWidth = 0;
    var particleHeight = 0;
    var replay = {
      mode: "idle",
      step: null,
      runId: 0,
      timeouts: [],
      progressTimer: null,
      lock: false,
      startedAtMs: 0,
      totalMs: 0
    };

    var unlockStep = 1;
    var state = {
      prior: window.RainModel.PRESETS.canonical.prior,
      tGivenR: window.RainModel.PRESETS.canonical.tGivenR,
      tGivenNotR: window.RainModel.PRESETS.canonical.tGivenNotR
    };

    var hashPartial = getInputFromHash();
    if (hashPartial) {
      state = {
        prior: window.RainModel.clamp01(hashPartial.prior !== undefined ? hashPartial.prior : state.prior),
        tGivenR: window.RainModel.clamp01(hashPartial.tGivenR !== undefined ? hashPartial.tGivenR : state.tGivenR),
        tGivenNotR: window.RainModel.clamp01(hashPartial.tGivenNotR !== undefined ? hashPartial.tGivenNotR : state.tGivenNotR)
      };
    }
    particles = createParticles(state.prior, PARTICLE_COUNT);

    var activePresetKey = getMatchingPresetKey(state);

    if (window.RainPreviewD3 && typeof window.RainPreviewD3.init === "function" && rainPreviewMount) {
      rainPreview = window.RainPreviewD3.init(rainPreviewMount, {
        maxDrops: PARTICLE_COUNT,
        panelMin: 220,
        panelMax: 280,
        strokeBase: 1.1,
        smoothing: 0.12,
        pulseMs: 320
      });
      if (rainPreview && typeof rainPreview.setReducedMotion === "function") {
        rainPreview.setReducedMotion(prefersReducedMotion);
      }
    }

    var announcePosterior = debounce(function (message) {
      if (announcer) {
        announcer.textContent = message;
      }
    }, 120);

    function onReducedMotionChanged(event) {
      prefersReducedMotion = !!event.matches;
      if (rainPreview && typeof rainPreview.setReducedMotion === "function") {
        rainPreview.setReducedMotion(prefersReducedMotion);
      }
      replay.lock = false;
      if (replay.mode === "playing") {
        cancelReplay("motion-change", { keepVisualState: false, keepProgress: false });
        render({ persistHash: false, resampleParticles: false, animateParticles: false });
      }
      if (prefersReducedMotion) {
        interruptParticleAnimation();
        syncParticlePositionsFromDom();
        renderParticlesAtCurrent();
      }
    }

    if (reduceMotionQuery) {
      if (typeof reduceMotionQuery.addEventListener === "function") {
        reduceMotionQuery.addEventListener("change", onReducedMotionChanged);
      } else if (typeof reduceMotionQuery.addListener === "function") {
        reduceMotionQuery.addListener(onReducedMotionChanged);
      }
    }

    function xFromProbability(probability) {
      return clamp01(probability) * particleWidth;
    }

    function yFromJitter(jitter) {
      var center = particleHeight * 0.5;
      var spread = particleHeight * PARTICLE_JITTER_SCALE;
      return center + jitter * spread;
    }

    function syncParticleViewport() {
      if (!posteriorTrack || !posteriorParticlesSvg) {
        return false;
      }

      var rect = posteriorTrack.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) {
        return false;
      }

      var width = rect.width;
      var height = rect.height;
      if (width !== particleWidth || height !== particleHeight) {
        particleWidth = width;
        particleHeight = height;
        posteriorParticlesSvg.setAttribute("viewBox", "0 0 " + fixed(width, 2) + " " + fixed(height, 2));
        posteriorParticlesSvg.setAttribute("width", fixed(width, 2));
        posteriorParticlesSvg.setAttribute("height", fixed(height, 2));
      }

      return true;
    }

    function interruptParticleAnimation() {
      if (particleRafId !== null) {
        window.cancelAnimationFrame(particleRafId);
        particleRafId = null;
      }
      if (d3Ref && posteriorParticlesSvg) {
        d3Ref.select(posteriorParticlesSvg).selectAll("circle.mass-particle").interrupt();
      }
    }

    function syncParticlePositionsFromDom() {
      if (!posteriorParticlesSvg || particleWidth <= 0) {
        return;
      }

      var nodes = posteriorParticlesSvg.querySelectorAll("circle.mass-particle");
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var id = Number(node.getAttribute("data-pid"));
        var cx = Number(node.getAttribute("cx"));
        if (!Number.isFinite(id) || !Number.isFinite(cx) || !particles[id]) {
          continue;
        }
        particles[id].p = clamp01(cx / particleWidth);
      }
    }

    function ensureD3ParticleSelection() {
      var selection = d3Ref.select(posteriorParticlesSvg).selectAll("circle.mass-particle")
        .data(particles, function (d) { return d.id; });

      selection.exit().remove();

      var entered = selection.enter()
        .append("circle")
        .attr("class", "mass-particle")
        .attr("data-pid", function (d) { return d.id; })
        .attr("r", PARTICLE_RADIUS_PX);

      return entered.merge(selection)
        .attr("cy", function (d) { return yFromJitter(d.yJitter); });
    }

    function ensureVanillaParticleNodes() {
      if (!posteriorParticlesSvg) {
        return [];
      }

      var nodes = posteriorParticlesSvg.querySelectorAll("circle.mass-particle");
      if (nodes.length !== particles.length) {
        posteriorParticlesSvg.innerHTML = "";

        var frag = document.createDocumentFragment();
        for (var i = 0; i < particles.length; i += 1) {
          var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("class", "mass-particle");
          circle.setAttribute("data-pid", String(particles[i].id));
          circle.setAttribute("r", String(PARTICLE_RADIUS_PX));
          frag.appendChild(circle);
        }
        posteriorParticlesSvg.appendChild(frag);
        nodes = posteriorParticlesSvg.querySelectorAll("circle.mass-particle");
      }
      return nodes;
    }

    function renderParticlesAtCurrent() {
      if (!syncParticleViewport()) {
        return;
      }

      if (d3Ref) {
        ensureD3ParticleSelection()
          .attr("cx", function (d) { return xFromProbability(d.p); })
          .attr("cy", function (d) { return yFromJitter(d.yJitter); });
        return;
      }

      var nodes = ensureVanillaParticleNodes();
      for (var i = 0; i < particles.length; i += 1) {
        var particle = particles[i];
        var node = nodes[i];
        if (!node) {
          continue;
        }
        node.setAttribute("cx", fixed(xFromProbability(particle.p), 3));
        node.setAttribute("cy", fixed(yFromJitter(particle.yJitter), 3));
      }
    }

    function animateParticlesWithVanilla(durationMs) {
      var nodes = ensureVanillaParticleNodes();
      if (!nodes.length) {
        return;
      }
      var motionMs = Math.max(1, Number(durationMs) || PARTICLE_DURATION_MS);

      var starts = particles.map(function (particle) {
        return particle.p;
      });

      var startedAt = performance.now();
      var tick = function (timestamp) {
        if (!syncParticleViewport()) {
          particleRafId = window.requestAnimationFrame(tick);
          return;
        }

        var progress = Math.min(1, (timestamp - startedAt) / motionMs);
        var eased = cubicInOut(progress);

        for (var i = 0; i < particles.length; i += 1) {
          var particle = particles[i];
          var current = starts[i] + (particle.targetP - starts[i]) * eased;
          var node = nodes[i];
          if (!node) {
            continue;
          }
          node.setAttribute("cx", fixed(xFromProbability(current), 3));
          node.setAttribute("cy", fixed(yFromJitter(particle.yJitter), 3));
        }

        if (progress >= 1) {
          for (var j = 0; j < particles.length; j += 1) {
            particles[j].p = particles[j].targetP;
          }
          particleRafId = null;
          return;
        }
        particleRafId = window.requestAnimationFrame(tick);
      };

      particleRafId = window.requestAnimationFrame(tick);
    }

    function updateParticles(model, options) {
      if (!posteriorParticlesSvg || !posteriorTrack) {
        return;
      }

      var opts = options || {};
      var driftMs = Number(opts.durationMs);
      if (!Number.isFinite(driftMs)) {
        driftMs = PARTICLE_DURATION_MS;
      }
      driftMs = Math.max(0, driftMs);
      if (!particles.length) {
        particles = createParticles(model.prior, PARTICLE_COUNT);
      }

      if (!syncParticleViewport()) {
        return;
      }

      if (opts.resample) {
        syncParticlePositionsFromDom();
        var nextTargets = samplePosteriorTargets(model.posterior, particles.length);
        for (var i = 0; i < particles.length; i += 1) {
          particles[i].targetP = nextTargets[i];
          particles[i].yJitter = randomJitter();
        }

        if (opts.animate && !prefersReducedMotion && driftMs > 0) {
          interruptParticleAnimation();
          if (d3Ref) {
            var easeFn = typeof d3Ref.easeCubicInOut === "function" ? d3Ref.easeCubicInOut : cubicInOut;
            ensureD3ParticleSelection()
              .attr("cx", function (d) { return xFromProbability(d.p); })
              .transition()
              .duration(driftMs)
              .ease(easeFn)
              .attr("cx", function (d) { return xFromProbability(d.targetP); })
              .on("end", function () {
                if (this && this.__data__) {
                  this.__data__.p = this.__data__.targetP;
                }
              });
          } else {
            animateParticlesWithVanilla(driftMs);
          }
          return;
        }

        interruptParticleAnimation();
        for (var j = 0; j < particles.length; j += 1) {
          particles[j].p = particles[j].targetP;
        }
      }

      renderParticlesAtCurrent();
    }

    if (typeof ResizeObserver !== "undefined" && posteriorTrack) {
      var particleResizeObserver = new ResizeObserver(function () {
        renderParticlesAtCurrent();
      });
      particleResizeObserver.observe(posteriorTrack);
    } else {
      window.addEventListener("resize", renderParticlesAtCurrent);
    }

    var priorRow = priorBar ? priorBar.closest(".bar-row") : null;
    var testimonyRow = ptBar ? ptBar.closest(".bar-row") : null;
    var posteriorRow = posteriorBar ? posteriorBar.closest(".bar-row") : null;

    function setReplayProgress(value) {
      if (!replayProgress) {
        return;
      }
      replayProgress.style.width = (clamp01(value) * 100).toFixed(1) + "%";
    }

    function setReplayPlayLabel() {
      if (!replayPlay) {
        return;
      }
      if (replay.mode === "playing") {
        replayPlay.textContent = "Restart";
      } else if (replay.step !== null) {
        replayPlay.textContent = "Replay";
      } else {
        replayPlay.textContent = "Play";
      }
    }

    function setActiveReplayStepButton(step) {
      replayStepButtons.forEach(function (button) {
        var buttonStep = Number(button.getAttribute("data-replay-step"));
        if (step !== null && buttonStep === step) {
          button.setAttribute("aria-current", "step");
        } else {
          button.removeAttribute("aria-current");
        }
      });

      if (replayPrev) {
        replayPrev.disabled = step === null ? true : step <= 1;
      }
      if (replayNext) {
        replayNext.disabled = step === null ? true : step >= 4;
      }
    }

    function clearReplayTimeouts() {
      replay.timeouts.forEach(function (entry) {
        if (!entry) {
          return;
        }
        if (entry.type === "d3-timeout" || entry.type === "d3-interval") {
          if (entry.handle && typeof entry.handle.stop === "function") {
            entry.handle.stop();
          }
        } else if (entry.type === "timeout") {
          clearTimeout(entry.handle);
        } else if (entry.type === "interval") {
          clearInterval(entry.handle);
        }
      });
      replay.timeouts = [];
      replay.progressTimer = null;
    }

    function scheduleReplayTimeout(callback, delayMs, runId) {
      var safeDelay = Math.max(0, Number(delayMs) || 0);
      if (d3Scheduler && typeof d3Scheduler.timeout === "function") {
        var d3Timeout = d3Scheduler.timeout(function () {
          if (runId !== replay.runId) {
            return;
          }
          callback();
        }, safeDelay);
        replay.timeouts.push({ type: "d3-timeout", handle: d3Timeout });
        return;
      }

      var nativeTimeout = setTimeout(function () {
        if (runId !== replay.runId) {
          return;
        }
        callback();
      }, safeDelay);
      replay.timeouts.push({ type: "timeout", handle: nativeTimeout });
    }

    function startReplayProgressLoop(totalDurationMs, runId) {
      var total = Math.max(1, Number(totalDurationMs) || 1);
      replay.startedAtMs = performance.now();
      replay.totalMs = total;
      setReplayProgress(0);

      var tick = function () {
        if (runId !== replay.runId || replay.mode !== "playing") {
          return;
        }
        var elapsed = performance.now() - replay.startedAtMs;
        var frac = clamp01(elapsed / total);
        setReplayProgress(frac);
      };

      if (d3Scheduler && typeof d3Scheduler.interval === "function") {
        var d3Interval = d3Scheduler.interval(tick, REPLAY_PROGRESS_TICK_MS);
        replay.timeouts.push({ type: "d3-interval", handle: d3Interval });
        replay.progressTimer = d3Interval;
      } else {
        var nativeInterval = setInterval(tick, REPLAY_PROGRESS_TICK_MS);
        replay.timeouts.push({ type: "interval", handle: nativeInterval });
        replay.progressTimer = nativeInterval;
      }
    }

    function getReplayProfile() {
      var reduced = !!prefersReducedMotion;
      return {
        stepHold: reduced ? REPLAY_STEP_HOLD_MS_REDUCED : REPLAY_STEP_HOLD_MS,
        transitionMs: reduced ? REPLAY_TRANSITION_MS_REDUCED : REPLAY_TRANSITION_MS,
        particleDriftMs: reduced ? REPLAY_PARTICLE_DRIFT_MS_REDUCED : REPLAY_PARTICLE_DRIFT_MS
      };
    }

    function getReplayTotalDuration(profile) {
      var p = profile || getReplayProfile();
      return p.stepHold[1] + p.stepHold[2] + p.stepHold[3] + p.stepHold[4];
    }

    function scheduleReplayCycle(runId, profile) {
      var p = profile || getReplayProfile();
      var hold = p.stepHold;
      var total = getReplayTotalDuration(p);

      if (runId !== replay.runId || replay.mode !== "playing") {
        return;
      }

      applyReplayStep(1, { animated: true });
      startReplayProgressLoop(total, runId);

      scheduleReplayTimeout(function () {
        applyReplayStep(2, { animated: true });
      }, hold[1], runId);

      scheduleReplayTimeout(function () {
        applyReplayStep(3, { animated: true });
      }, hold[1] + hold[2], runId);

      scheduleReplayTimeout(function () {
        applyReplayStep(4, { animated: true });
      }, hold[1] + hold[2] + hold[3], runId);

      scheduleReplayTimeout(function () {
        if (runId !== replay.runId || replay.mode !== "playing") {
          return;
        }
        clearReplayTimeouts();
        setReplayProgress(1);
        scheduleReplayTimeout(function () {
          scheduleReplayCycle(runId, p);
        }, REPLAY_LOOP_GAP_MS, runId);
      }, total, runId);
    }

    function clearReplayVisualClasses() {
      if (priorBar) {
        priorBar.classList.remove("is-ghosted");
        priorBar.style.transitionDuration = "";
      }
      if (ptBar) {
        ptBar.classList.remove("is-subdued");
        ptBar.style.transitionDuration = "";
      }
      if (posteriorBar) {
        posteriorBar.classList.remove("is-hidden");
        posteriorBar.style.transitionDuration = "";
      }
      if (posteriorBarValue) {
        posteriorBarValue.classList.remove("is-hidden-text");
      }
      if (testimonyRow) {
        testimonyRow.classList.remove("is-highlight");
      }
      if (testimonyStrip) {
        testimonyStrip.classList.remove("is-highlight");
      }
      if (thresholdMarker) {
        thresholdMarker.classList.remove("is-active");
      }
      if (decisionPanel) {
        decisionPanel.classList.remove("is-emphasis");
      }
      if (decisionUmbrella) {
        decisionUmbrella.classList.remove("is-active");
        decisionUmbrella.classList.remove("is-emphasis");
      }
      if (decisionText) {
        decisionText.classList.remove("decision-go");
        decisionText.classList.remove("decision-hold");
      }
      root.classList.remove("replay-playing");
      root.removeAttribute("data-replay-step");
    }

    function setThresholdVisual() {
      root.style.setProperty("--rain-threshold", percent(DECISION_THRESHOLD));
      if (decisionThresholdReadout) {
        decisionThresholdReadout.textContent = "Action threshold: " + percent(DECISION_THRESHOLD);
      }
    }

    function cancelReplay(reason, options) {
      var opts = options || {};
      clearReplayTimeouts();
      replay.mode = "idle";
      replay.lock = false;
      replay.runId += 1;

      if (!opts.keepStep) {
        replay.step = null;
      }

      if (!opts.keepVisualState) {
        clearReplayVisualClasses();
      }

      if (!opts.keepProgress) {
        setReplayProgress(0);
      }

      setActiveReplayStepButton(replay.step);
      setReplayPlayLabel();
    }

    var CurvesViz = {
      setVisibility: function (options) {
        var opts = options || {};
        var transitionMs = Number(opts.transitionMs);
        var hasTransition = Number.isFinite(transitionMs);

        if (priorBar) {
          priorBar.classList.toggle("is-ghosted", !!opts.ghostPrior);
          if (hasTransition) {
            priorBar.style.transitionDuration = Math.max(0, transitionMs) + "ms";
          }
        }
        if (ptBar) {
          ptBar.classList.toggle("is-subdued", !!opts.subdueLikelihood);
          if (hasTransition) {
            ptBar.style.transitionDuration = Math.max(0, transitionMs) + "ms";
          }
        }
        if (posteriorBar) {
          posteriorBar.classList.toggle("is-hidden", opts.showPosterior === false);
          if (hasTransition) {
            posteriorBar.style.transitionDuration = Math.max(0, transitionMs) + "ms";
          }
        }
        if (posteriorGhost) {
          posteriorGhost.style.opacity = opts.showPosterior === false ? "0" : "";
        }
        if (posteriorRow) {
          posteriorRow.classList.toggle("is-highlight", !!opts.highlightPosterior);
        }
      },
      setHighlight: function (kind) {
        if (testimonyRow) {
          testimonyRow.classList.toggle("is-highlight", kind === "likelihood");
        }
        if (testimonyStrip) {
          testimonyStrip.classList.toggle("is-highlight", kind === "likelihood");
        }
      }
    };

    var ParticlesViz = {
      setStaticPrior: function (priorMean) {
        particles = createParticles(priorMean, PARTICLE_COUNT);
        updateParticles(
          {
            prior: priorMean,
            posterior: priorMean
          },
          {
            resample: false,
            animate: false,
            durationMs: 0
          }
        );
      },
      playDriftToPosterior: function (options) {
        var opts = options || {};
        if (opts.fromPrior === true) {
          this.setStaticPrior(opts.priorMean);
        }
        updateParticles(
          {
            prior: opts.priorMean,
            posterior: opts.posterior
          },
          {
            resample: opts.resample !== false,
            animate: !!opts.animate,
            durationMs: opts.durationMs
          }
        );
      }
    };

    var GaugesViz = {
      update: function (model, options) {
        var opts = options || {};
        if (opts.hidePosterior) {
          posteriorBarValue.classList.add("is-hidden-text");
          posteriorBarValue.textContent = "hidden";
          advancedPost.textContent = "hidden until update";
          advancedEvidence.textContent = "hidden until update";
          advancedKl.textContent = "hidden until update";
          return;
        }

        posteriorBarValue.classList.remove("is-hidden-text");
        posteriorBarValue.textContent = percent(model.posterior);
        advancedPost.textContent = fixed(model.posterior, 3);
        advancedEvidence.textContent = fixed(model.logEvidence, 3);
        advancedKl.textContent = fixed(model.klUpdateCost, 3);
      }
    };

    var DecisionViz = {
      setThreshold: function (value) {
        var threshold = clamp01(value);
        root.style.setProperty("--rain-threshold", percent(threshold));
        if (decisionThresholdReadout) {
          decisionThresholdReadout.textContent = "Action threshold: " + percent(threshold);
        }
      },
      flashThreshold: function () {
        if (!thresholdMarker) {
          return;
        }
        thresholdMarker.classList.remove("is-active");
        if (!prefersReducedMotion) {
          thresholdMarker.classList.add("is-active");
        }
      },
      setDecisionState: function (posterior, options) {
        if (!decisionText) {
          return;
        }
        var opts = options || {};
        var takeUmbrella = posterior >= DECISION_THRESHOLD;
        decisionText.textContent = takeUmbrella ? "Take umbrella" : "No umbrella";
        decisionText.classList.toggle("decision-go", takeUmbrella);
        decisionText.classList.toggle("decision-hold", !takeUmbrella);
        if (decisionUmbrella) {
          decisionUmbrella.classList.toggle("is-active", takeUmbrella);
        }
        if (decisionPanel) {
          decisionPanel.classList.toggle("is-emphasis", !!opts.emphasize);
        }
        if (decisionUmbrella) {
          decisionUmbrella.classList.toggle("is-emphasis", !!opts.emphasize && !prefersReducedMotion);
        }
      },
      setNeutral: function () {
        if (!decisionText) {
          return;
        }
        decisionText.textContent = "Decision pending";
        decisionText.classList.remove("decision-go");
        decisionText.classList.remove("decision-hold");
        if (decisionPanel) {
          decisionPanel.classList.remove("is-emphasis");
        }
        if (decisionUmbrella) {
          decisionUmbrella.classList.remove("is-active");
          decisionUmbrella.classList.remove("is-emphasis");
        }
      }
    };

    function applyReplayStep(step, options) {
      var opts = options || {};
      var replayStep = Math.max(1, Math.min(4, Number(step) || 1));
      var previousReplayStep = replay.step;
      var profile = getReplayProfile();
      var model = window.RainModel.deriveState(state);
      var shouldAnimate = !!opts.animated && !prefersReducedMotion;

      replay.step = replayStep;
      setActiveReplayStepButton(replayStep);
      root.setAttribute("data-replay-step", String(replayStep));
      root.classList.toggle("replay-playing", replay.mode === "playing");

      render({
        announce: false,
        persistHash: false,
        resampleParticles: false,
        animateParticles: false
      });

      clearReplayVisualClasses();
      root.setAttribute("data-replay-step", String(replayStep));
      root.classList.toggle("replay-playing", replay.mode === "playing");

      CurvesViz.setHighlight(null);
      DecisionViz.setNeutral();

      if (replayStep === 1) {
        CurvesViz.setVisibility({
          ghostPrior: false,
          subdueLikelihood: true,
          showPosterior: false,
          highlightPosterior: false,
          transitionMs: profile.transitionMs
        });
        GaugesViz.update(model, { hidePosterior: true });
        ParticlesViz.setStaticPrior(model.prior);
        summary.textContent = "Step 1/4: Start with your prior belief before testimony.";
        return;
      }

      if (replayStep === 2) {
        CurvesViz.setVisibility({
          ghostPrior: false,
          subdueLikelihood: false,
          showPosterior: false,
          highlightPosterior: false,
          transitionMs: profile.transitionMs
        });
        CurvesViz.setHighlight("likelihood");
        GaugesViz.update(model, { hidePosterior: true });
        ParticlesViz.setStaticPrior(model.prior);
        summary.textContent = "Step 2/4: Highlight testimony as a reliability-weighted signal.";
        return;
      }

      if (replayStep === 3) {
        CurvesViz.setVisibility({
          ghostPrior: true,
          subdueLikelihood: false,
          showPosterior: true,
          highlightPosterior: true,
          transitionMs: profile.transitionMs
        });
        GaugesViz.update(model, { hidePosterior: false });
        ParticlesViz.playDriftToPosterior({
          priorMean: model.prior,
          posterior: model.posterior,
          fromPrior: true,
          animate: shouldAnimate,
          durationMs: profile.particleDriftMs
        });
        pulseRainPreview("replay", model.prior, model.posterior);
        summary.textContent = "Step 3/4: Bayes forces an updated posterior from prior and testimony.";
        return;
      }

      CurvesViz.setVisibility({
        ghostPrior: true,
        subdueLikelihood: false,
        showPosterior: true,
        highlightPosterior: true,
        transitionMs: profile.transitionMs
      });
      GaugesViz.update(model, { hidePosterior: false });
      ParticlesViz.playDriftToPosterior({
        priorMean: model.prior,
        posterior: model.posterior,
        fromPrior: false,
        resample: previousReplayStep !== 3,
        animate: false,
        durationMs: 0
      });
      DecisionViz.setDecisionState(model.posterior, { emphasize: true });
      DecisionViz.flashThreshold();
      summary.textContent = "Step 4/4: Compare posterior to threshold and choose the action.";
    }

    function startReplay() {
      var profile = getReplayProfile();
      var runId;

      cancelReplay("restart", { keepVisualState: false, keepProgress: false });
      replay.mode = "playing";
      replay.lock = true;
      replay.runId += 1;
      runId = replay.runId;
      setReplayPlayLabel();
      scheduleReplayCycle(runId, profile);
    }

    function jumpToReplayStep(step) {
      cancelReplay("manual-step", { keepVisualState: false, keepProgress: false });
      replay.step = Math.max(1, Math.min(4, Number(step) || 1));
      setReplayProgress((replay.step - 1) / 3);
      setReplayPlayLabel();
      applyReplayStep(replay.step, { animated: !prefersReducedMotion });
    }

    setThresholdVisual();
    DecisionViz.setThreshold(DECISION_THRESHOLD);

    function syncSliders() {
      priorSlider.value = fixed(state.prior, 2);
      truthSlider.value = fixed(state.tGivenR, 2);
      falseSlider.value = fixed(state.tGivenNotR, 2);
    }

    function isGuessMode() {
      return guessFirst && guessFirst.checked;
    }

    function shouldPersistHash() {
      return unlockStep >= 3;
    }

    function updateActivePresetFromManualInput() {
      if (activePresetKey && !statesMatchPreset(state, window.RainModel.PRESETS[activePresetKey])) {
        activePresetKey = null;
      }
    }

    function updateIntuitionText(model) {
      var move = deriveMoveLabel(model);
      intuition.textContent = "Current update magnitude: " + move + ". Delta = " + percent(Math.abs(model.posterior - model.prior)) + ".";
    }

    function updateRainPreview(model) {
      if (!rainPreview) {
        return;
      }

      var signals = deriveRainPreviewSignals(model);
      rainPreview.setTargetParams(signals);

      if (rainPreviewProb) {
        rainPreviewProb.textContent = "P(rain | testimony) = " + fixed(model.posterior, 2);
      }
      if (rainPreviewCertainty) {
        rainPreviewCertainty.textContent = "certainty: " + certaintyLabelFromUncertainty(signals.u);
      }
    }

    function pulseRainPreview(type, previousPosterior, nextPosterior) {
      if (!rainPreview || typeof rainPreview.pulse !== "function") {
        return;
      }

      if (type === "replay") {
        rainPreview.pulse("replay");
        return;
      }

      var prev = clamp01(previousPosterior);
      var next = clamp01(nextPosterior);
      var delta = Math.abs(next - prev);
      rainPreview.pulse(delta >= RAIN_PREVIEW_LARGE_DELTA ? "strong" : "testimony");
    }

    function render(options) {
      var opts = options || {};
      var model = window.RainModel.deriveState(state);

      priorValue.textContent = percent(model.prior);
      truthValue.textContent = percent(model.tGivenR);
      falseValue.textContent = percent(model.tGivenNotR);

      priorBar.style.width = percent(model.prior);
      ptBar.style.width = percent(model.pTestimony);
      if (posteriorGhost) {
        posteriorGhost.style.width = percent(model.prior);
      }
      posteriorBar.style.width = percent(model.posterior);

      priorBarValue.textContent = percent(model.prior);
      ptBarValue.textContent = percent(model.pTestimony);
      posteriorBarValue.textContent = isGuessMode() ? "hidden" : percent(model.posterior);

      if (isGuessMode()) {
        summary.textContent = "Guess-first mode is on. Predict whether testimony moves belief a lot or a little, then reveal.";
      } else {
        summary.textContent =
          "Posterior rain chance after testimony: " + percent(model.posterior) +
          " (prior " + percent(model.prior) + ", testimony event " + percent(model.pTestimony) + ").";
      }

      advancedPt.textContent = fixed(model.pTestimony, 3);
      advancedNum.textContent = fixed(model.numerator, 3);
      if (isGuessMode()) {
        advancedPost.textContent = "hidden until reveal";
        advancedEvidence.textContent = "hidden until reveal";
        advancedKl.textContent = "hidden until reveal";
      } else {
        advancedPost.textContent = fixed(model.posterior, 3);
        advancedEvidence.textContent = fixed(model.logEvidence, 3);
        advancedKl.textContent = fixed(model.klUpdateCost, 3);
      }

      updateIntuitionText(model);
      updateRainPreview(model);
      applyUnlock(root, unlockStep);
      updatePresetButtons(presetButtons, activePresetKey);
      updateParticles(model, {
        resample: !!opts.resampleParticles,
        animate: !!opts.animateParticles,
        durationMs: opts.particleDurationMs
      });

      if (replay.step === null) {
        DecisionViz.setDecisionState(model.posterior, { emphasize: false });
      }

      if (opts.persistHash !== false && shouldPersistHash()) {
        writeHash(model);
      }

      if (opts.announce) {
        if (isGuessMode()) {
          announcePosterior("Guess-first mode is on. Posterior values are hidden until reveal.");
        } else {
          announcePosterior("Updated posterior rain chance: " + percent(model.posterior) + ".");
        }
      }
    }

    function setState(nextState, options) {
      var opts = options || {};

      state = {
        prior: window.RainModel.clamp01(nextState.prior),
        tGivenR: window.RainModel.clamp01(nextState.tGivenR),
        tGivenNotR: window.RainModel.clamp01(nextState.tGivenNotR)
      };

      if (opts.presetKey) {
        activePresetKey = opts.presetKey;
      }

      if (opts.clearPreset) {
        activePresetKey = null;
      }

      syncSliders();
      render({
        announce: !!opts.announce,
        persistHash: opts.persistHash,
        resampleParticles: !!opts.resampleParticles,
        animateParticles: !!opts.animateParticles
      });
    }

    function setUnlockStep(nextStep) {
      // One-way progression: once a step is unlocked, it stays unlocked.
      var previousStep = unlockStep;
      unlockStep = Math.max(unlockStep, Number(nextStep) || 1);
      applyUnlock(root, unlockStep);

      if (unlockStep !== previousStep && unlockStep >= 3) {
        render({ persistHash: true });
      }
    }

    function onSliderInput(key, value) {
      cancelReplay("slider-input", { keepVisualState: false, keepProgress: false });
      state[key] = Number(value);
      updateActivePresetFromManualInput();
      render({ resampleParticles: false, animateParticles: false });
    }

    function onSliderCommit(key, value) {
      var previousPosterior = window.RainModel.deriveState(state).posterior;
      cancelReplay("slider-commit", { keepVisualState: false, keepProgress: false });
      state[key] = Number(value);
      updateActivePresetFromManualInput();
      render({ announce: true, resampleParticles: true, animateParticles: true });
      pulseRainPreview("testimony", previousPosterior, window.RainModel.deriveState(state).posterior);
    }

    priorSlider.addEventListener("input", function () {
      onSliderInput("prior", priorSlider.value);
    });
    priorSlider.addEventListener("change", function () {
      onSliderCommit("prior", priorSlider.value);
    });

    truthSlider.addEventListener("input", function () {
      onSliderInput("tGivenR", truthSlider.value);
    });
    truthSlider.addEventListener("change", function () {
      onSliderCommit("tGivenR", truthSlider.value);
    });

    falseSlider.addEventListener("input", function () {
      onSliderInput("tGivenNotR", falseSlider.value);
    });
    falseSlider.addEventListener("change", function () {
      onSliderCommit("tGivenNotR", falseSlider.value);
    });

    presetButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var previousPosterior = window.RainModel.deriveState(state).posterior;
        cancelReplay("preset", { keepVisualState: false, keepProgress: false });
        var presetKey = button.getAttribute("data-preset");
        var preset = window.RainModel.PRESETS[presetKey];
        if (!preset) {
          return;
        }

        setState(
          {
            prior: preset.prior,
            tGivenR: preset.tGivenR,
            tGivenNotR: preset.tGivenNotR
          },
          {
            presetKey: presetKey,
            announce: true,
            resampleParticles: true,
            animateParticles: true
          }
        );
        pulseRainPreview("testimony", previousPosterior, window.RainModel.deriveState(state).posterior);
      });
    });

    if (guessFirst) {
      guessFirst.addEventListener("change", function () {
        cancelReplay("guess-toggle", { keepVisualState: false, keepProgress: false });
        render({ announce: true });
      });
    }

    if (revealGuess) {
      revealGuess.addEventListener("click", function () {
        cancelReplay("guess-reveal", { keepVisualState: false, keepProgress: false });
        if (guessFirst) {
          guessFirst.checked = false;
        }
        render({ announce: true });
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        var previousPosterior = window.RainModel.deriveState(state).posterior;
        cancelReplay("reset", { keepVisualState: false, keepProgress: false });
        var preset = window.RainModel.PRESETS.canonical;
        setState(
          {
            prior: preset.prior,
            tGivenR: preset.tGivenR,
            tGivenNotR: preset.tGivenNotR
          },
          {
            presetKey: "canonical",
            announce: true,
            resampleParticles: true,
            animateParticles: true
          }
        );
        pulseRainPreview("testimony", previousPosterior, window.RainModel.deriveState(state).posterior);
      });
    }

    if (replayPlay) {
      replayPlay.addEventListener("click", function () {
        startReplay();
      });
    }

    if (replayPrev) {
      replayPrev.addEventListener("click", function () {
        var current = replay.step === null ? 1 : replay.step;
        jumpToReplayStep(current - 1);
      });
    }

    if (replayNext) {
      replayNext.addEventListener("click", function () {
        var current = replay.step === null ? 1 : replay.step;
        jumpToReplayStep(current + 1);
      });
    }

    replayStepButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        jumpToReplayStep(Number(button.getAttribute("data-replay-step")));
      });
    });

    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && replay.mode === "playing") {
        event.preventDefault();
        cancelReplay("escape", { keepVisualState: false, keepProgress: false });
        render({ persistHash: false, resampleParticles: false, animateParticles: false });
      }
    });

    window.addEventListener("beforeunload", function () {
      if (rainPreview && typeof rainPreview.destroy === "function") {
        rainPreview.destroy();
      }
      rainPreview = null;
    });

    bindUnlocking(setUnlockStep);

    syncSliders();
    setActiveReplayStepButton(null);
    setReplayProgress(0);
    setReplayPlayLabel();
    render({ persistHash: false });
  }

  window.initRainEngine = initRainEngine;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initRainEngine("rain-engine");
    });
  } else {
    initRainEngine("rain-engine");
  }
})();
