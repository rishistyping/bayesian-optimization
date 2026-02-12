(function () {
  var LOCKED_HELP_ID = "";
  var PARTICLE_COUNT = 320;
  var PARTICLE_DURATION_MS = 520;
  var PARTICLE_RADIUS_PX = 1.9;
  var PARTICLE_JITTER_SCALE = 0.36;
  var BETA_CONCENTRATION = 18;
  var CDF_BINS = 256;
  var SHAPE_EPS = 1e-3;
  var PROB_EPS = 1e-6;
  var DEFAULT_DECISION_THRESHOLD = 0.60;
  var DEFAULT_FALSE_POSITIVE_COST = 1.0;
  var DEFAULT_FALSE_NEGATIVE_COST = 1.0;
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
  var PREDICTION_SAME_DELTA = 0.03;

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

    var decisionThreshold = parseHashNumber(params.get("dt"));
    if (decisionThreshold !== null) {
      partial.decisionThreshold = decisionThreshold;
      hasAny = true;
    }

    var falsePositiveCost = parseHashNumber(params.get("cfp"));
    if (falsePositiveCost !== null) {
      partial.falsePositiveCost = falsePositiveCost;
      hasAny = true;
    }

    var falseNegativeCost = parseHashNumber(params.get("cfn"));
    if (falseNegativeCost !== null) {
      partial.falseNegativeCost = falseNegativeCost;
      hasAny = true;
    }

    var useCostThreshold = params.get("uc");
    if (useCostThreshold === "1" || useCostThreshold === "0") {
      partial.useCostThreshold = useCostThreshold === "1";
      hasAny = true;
    }

    return hasAny ? partial : null;
  }

  function writeHash(state) {
    var params = new URLSearchParams();
    params.set("prior", fixed(state.prior, 2));
    params.set("tgr", fixed(state.tGivenR, 2));
    params.set("tgnr", fixed(state.tGivenNotR, 2));
    params.set("dt", fixed(state.decisionThreshold, 2));
    params.set("cfp", fixed(state.falsePositiveCost, 1));
    params.set("cfn", fixed(state.falseNegativeCost, 1));
    params.set("uc", state.useCostThreshold ? "1" : "0");

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
    var storySubsections = Array.prototype.slice.call(document.querySelectorAll("[data-story-step]"));

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

    storySubsections.forEach(function (section) {
      var sectionStep = Number(section.getAttribute("data-story-step"));
      var storyUnlocked = sectionStep <= unlockStep;
      var content = section.querySelector(".story-subsection-content");
      var lockNote = section.querySelector(".story-subsection-lock-note");

      section.classList.toggle("is-story-locked", !storyUnlocked);

      if (storyUnlocked) {
        section.removeAttribute("aria-disabled");
      } else {
        section.setAttribute("aria-disabled", "true");
      }

      if (content) {
        content.hidden = !storyUnlocked;
        content.setAttribute("aria-hidden", storyUnlocked ? "false" : "true");
      }

      if (lockNote) {
        lockNote.hidden = storyUnlocked;
        lockNote.setAttribute("aria-hidden", storyUnlocked ? "true" : "false");
      }
    });
  }

  function initRainEngine(rootId) {
    var root = document.getElementById(rootId);
    if (!root || !window.RainModel) {
      return;
    }

    // Hide loading state and show engine shell
    var loadingEl = document.getElementById("engine-loading");
    var shellEl = root.querySelector(".engine-shell");
    if (loadingEl) {
      loadingEl.classList.add("is-hidden");
    }
    if (shellEl) {
      shellEl.classList.add("is-ready");
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
    var engineMotionNote = root.querySelector("#engine-motion-note");

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
    var decisionThresholdSlider = root.querySelector("#decision-threshold-slider");
    var decisionThresholdValue = root.querySelector("#decision-threshold-value");
    var decisionUseCosts = root.querySelector("#decision-use-costs");
    var costFalsePositive = root.querySelector("#cost-false-positive");
    var costFalsePositiveValue = root.querySelector("#cost-false-positive-value");
    var costFalseNegative = root.querySelector("#cost-false-negative");
    var costFalseNegativeValue = root.querySelector("#cost-false-negative-value");
    var decisionLossReadout = root.querySelector("#decision-loss-readout");
    var rainPreviewMount = root.querySelector("#rain-preview");
    var rainPreviewProb = root.querySelector("#rain-preview-prob");
    var rainPreviewCertainty = root.querySelector("#rain-preview-certainty");
    var conditionalPanel = document.getElementById("conditional-probability-panel");
    var conditionalMotionNote = document.getElementById("cp-motion-note");
    var copyLinkButton = root.querySelector("#copy-link-btn");
    var copyLinkStatus = root.querySelector("#copy-link-status");
    var predictionButtons = Array.prototype.slice.call(root.querySelectorAll("button[data-predict]"));
    var predictionFeedback = root.querySelector("#prediction-feedback");

    var resetButton = root.querySelector("#reset-state");
    var presetButtons = Array.prototype.slice.call(root.querySelectorAll("button[data-preset]"));
    var d3Ref = window.d3 && typeof window.d3.select === "function" ? window.d3 : null;
    var d3Scheduler = window.d3 && typeof window.d3.timeout === "function" ? window.d3 : null;
    var reduceMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var prefersReducedMotion = !!(reduceMotionQuery && reduceMotionQuery.matches);
    var rainPreview = null;
    var conditionalViz = null;
    var conditionalUserPerspective = "universe";
    var conditionalReplayControlled = false;
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
    var copyLinkStatusTimer = null;
    var predictionChoice = null;
    var inputRenderRafId = null;
    var sliderVisualInputs = [
      priorSlider,
      truthSlider,
      falseSlider,
      decisionThresholdSlider,
      costFalsePositive,
      costFalseNegative
    ].filter(Boolean);

    var unlockStep = 1;
    var state = {
      prior: window.RainModel.PRESETS.canonical.prior,
      tGivenR: window.RainModel.PRESETS.canonical.tGivenR,
      tGivenNotR: window.RainModel.PRESETS.canonical.tGivenNotR
    };
    var decisionState = {
      threshold: DEFAULT_DECISION_THRESHOLD,
      useCostThreshold: false,
      falsePositiveCost: DEFAULT_FALSE_POSITIVE_COST,
      falseNegativeCost: DEFAULT_FALSE_NEGATIVE_COST
    };

    var hashPartial = getInputFromHash();
    if (hashPartial) {
      state = {
        prior: window.RainModel.clamp01(hashPartial.prior !== undefined ? hashPartial.prior : state.prior),
        tGivenR: window.RainModel.clamp01(hashPartial.tGivenR !== undefined ? hashPartial.tGivenR : state.tGivenR),
        tGivenNotR: window.RainModel.clamp01(hashPartial.tGivenNotR !== undefined ? hashPartial.tGivenNotR : state.tGivenNotR)
      };
      decisionState.threshold = clamp01(hashPartial.decisionThreshold !== undefined ? hashPartial.decisionThreshold : decisionState.threshold);
      decisionState.falsePositiveCost = Math.max(0.1, Number.isFinite(hashPartial.falsePositiveCost) ? hashPartial.falsePositiveCost : decisionState.falsePositiveCost);
      decisionState.falseNegativeCost = Math.max(0.1, Number.isFinite(hashPartial.falseNegativeCost) ? hashPartial.falseNegativeCost : decisionState.falseNegativeCost);
      if (typeof hashPartial.useCostThreshold === "boolean") {
        decisionState.useCostThreshold = hashPartial.useCostThreshold;
      }
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

    if (window.RainConditionalD3 && typeof window.RainConditionalD3.init === "function" && conditionalPanel) {
      conditionalViz = window.RainConditionalD3.init(conditionalPanel, {
        reducedMotion: prefersReducedMotion,
        maxDrops: 180,
        spawnMs: 55,
        onUserInteraction: function (detail) {
          if (detail && detail.type === "perspective" && detail.perspective) {
            conditionalUserPerspective = detail.perspective;
          }
          if (replay.mode === "playing") {
            cancelReplay("conditional-interaction", { keepVisualState: false, keepProgress: false });
            render({ persistHash: false, resampleParticles: false, animateParticles: false });
          }
        }
      });
    }

    var announcePosterior = debounce(function (message) {
      if (announcer) {
        announcer.textContent = message;
      }
    }, 120);

    function updateMotionModeNotes() {
      var message = "Reduced motion enabled: animations are shown as static states.";
      var show = !!prefersReducedMotion;
      if (engineMotionNote) {
        engineMotionNote.hidden = !show;
        engineMotionNote.textContent = show ? message : "";
      }
      if (conditionalMotionNote) {
        conditionalMotionNote.hidden = !show;
        conditionalMotionNote.textContent = show ? message : "";
      }
    }

    function onReducedMotionChanged(event) {
      prefersReducedMotion = !!event.matches;
      cancelScheduledInputRender();
      updateMotionModeNotes();
      if (rainPreview && typeof rainPreview.setReducedMotion === "function") {
        rainPreview.setReducedMotion(prefersReducedMotion);
      }
      if (conditionalViz && typeof conditionalViz.setReducedMotion === "function") {
        conditionalViz.setReducedMotion(prefersReducedMotion);
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
    updateMotionModeNotes();

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
      root.style.setProperty("--rain-threshold", percent(decisionState.threshold));
      if (decisionThresholdReadout) {
        var suffix = decisionState.useCostThreshold ? " (cost mode)" : "";
        decisionThresholdReadout.textContent = "Action threshold: " + percent(decisionState.threshold) + suffix;
      }
      if (decisionThresholdSlider) {
        decisionThresholdSlider.value = fixed(decisionState.threshold, 2);
      }
      if (decisionThresholdValue) {
        decisionThresholdValue.textContent = percent(decisionState.threshold);
      }
      if (decisionUseCosts) {
        decisionUseCosts.checked = !!decisionState.useCostThreshold;
      }
      if (costFalsePositive) {
        costFalsePositive.value = fixed(decisionState.falsePositiveCost, 1);
      }
      if (costFalsePositiveValue) {
        costFalsePositiveValue.textContent = fixed(decisionState.falsePositiveCost, 1);
      }
      if (costFalseNegative) {
        costFalseNegative.value = fixed(decisionState.falseNegativeCost, 1);
      }
      if (costFalseNegativeValue) {
        costFalseNegativeValue.textContent = fixed(decisionState.falseNegativeCost, 1);
      }
      syncSliderVisuals();
    }

    function refreshThresholdFromCosts() {
      if (!decisionState.useCostThreshold) {
        return;
      }
      var cfp = Math.max(0.1, decisionState.falsePositiveCost);
      var cfn = Math.max(0.1, decisionState.falseNegativeCost);
      decisionState.threshold = clamp01(cfp / (cfp + cfn));
    }

    function updateLossReadout(model) {
      if (!decisionLossReadout) {
        return;
      }
      var p = clamp01(model.posterior);
      var umbrellaLoss = decisionState.falsePositiveCost * (1 - p);
      var noUmbrellaLoss = decisionState.falseNegativeCost * p;
      decisionLossReadout.textContent =
        "Expected loss (umbrella/no umbrella): " +
        fixed(umbrellaLoss, 2) +
        " / " +
        fixed(noUmbrellaLoss, 2);
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

      if (!opts.keepVisualState && conditionalViz && conditionalReplayControlled) {
        conditionalReplayControlled = false;
        if (typeof conditionalViz.setHighlightedEvent === "function") {
          conditionalViz.setHighlightedEvent(null);
        }
        if (typeof conditionalViz.setPerspective === "function") {
          conditionalViz.setPerspective(conditionalUserPerspective, {
            animate: !prefersReducedMotion,
            source: "engine",
            mode: "direct"
          });
        }
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
        decisionState.threshold = clamp01(value);
        setThresholdVisual();
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
        var takeUmbrella = posterior >= decisionState.threshold;
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
      if (conditionalViz) {
        conditionalReplayControlled = true;
      }

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
        if (conditionalViz) {
          if (typeof conditionalViz.setPerspective === "function") {
            conditionalViz.setPerspective("universe", { animate: shouldAnimate, source: "replay", mode: "direct" });
          }
          if (typeof conditionalViz.setHighlightedEvent === "function") {
            conditionalViz.setHighlightedEvent("rain");
          }
        }
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
        if (conditionalViz) {
          if (typeof conditionalViz.setPerspective === "function") {
            conditionalViz.setPerspective("universe", { animate: shouldAnimate, source: "replay", mode: "direct" });
          }
          if (typeof conditionalViz.setHighlightedEvent === "function") {
            conditionalViz.setHighlightedEvent("testimony");
          }
        }
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
        resolvePrediction(model);
        pulseRainPreview("replay", model.prior, model.posterior);
        if (conditionalViz) {
          if (typeof conditionalViz.setPerspective === "function") {
            conditionalViz.setPerspective("testimony", { animate: shouldAnimate, source: "replay", mode: "staged" });
          }
          if (typeof conditionalViz.setHighlightedEvent === "function") {
            conditionalViz.setHighlightedEvent("testimony");
          }
        }
        summary.textContent = "Step 3/4: Bayes forces an updated posterior from prior and testimony. Now we are only counting testimony-positive days.";
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
      if (conditionalViz) {
        if (typeof conditionalViz.setPerspective === "function") {
          conditionalViz.setPerspective("testimony", { animate: false, source: "replay", mode: "direct" });
        }
        if (typeof conditionalViz.setHighlightedEvent === "function") {
          conditionalViz.setHighlightedEvent(null);
        }
      }
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

    refreshThresholdFromCosts();
    setThresholdVisual();
    DecisionViz.setThreshold(decisionState.threshold);

    function syncSliders() {
      priorSlider.value = fixed(state.prior, 2);
      truthSlider.value = fixed(state.tGivenR, 2);
      falseSlider.value = fixed(state.tGivenNotR, 2);
      syncSliderVisuals();
    }

    function updateSliderVisual(sliderEl) {
      if (!sliderEl) {
        return;
      }
      var min = Number(sliderEl.min);
      var max = Number(sliderEl.max);
      var value = Number(sliderEl.value);
      if (!Number.isFinite(min)) {
        min = 0;
      }
      if (!Number.isFinite(max) || max <= min) {
        max = min + 1;
      }
      if (!Number.isFinite(value)) {
        value = min;
      }
      var pct = ((value - min) / (max - min)) * 100;
      pct = Math.max(0, Math.min(100, pct));
      sliderEl.style.setProperty("--slider-pct", fixed(pct, 2) + "%");
    }

    function syncSliderVisuals() {
      sliderVisualInputs.forEach(updateSliderVisual);
    }

    function predictionLabel(kind) {
      if (kind === "lower") {
        return "lower";
      }
      if (kind === "higher") {
        return "higher";
      }
      return "about the same";
    }

    function classifyPosteriorShift(model) {
      var delta = Number(model.posterior) - Number(model.prior);
      if (delta > PREDICTION_SAME_DELTA) {
        return "higher";
      }
      if (delta < -PREDICTION_SAME_DELTA) {
        return "lower";
      }
      return "same";
    }

    function setPredictionFeedbackMessage(message, statusClass) {
      if (!predictionFeedback) {
        return;
      }
      predictionFeedback.textContent = message || "";
      predictionFeedback.classList.remove("is-correct");
      predictionFeedback.classList.remove("is-incorrect");
      if (statusClass) {
        predictionFeedback.classList.add(statusClass);
      }
    }

    function syncPredictionButtons() {
      predictionButtons.forEach(function (button) {
        var value = button.getAttribute("data-predict");
        var selected = value === predictionChoice;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    }

    function markPredictionPending() {
      if (!predictionChoice) {
        setPredictionFeedbackMessage("", null);
        return;
      }
      setPredictionFeedbackMessage("Prediction saved. Commit an update to check it.", null);
    }

    function resolvePrediction(model) {
      if (!predictionChoice) {
        return;
      }

      var actual = classifyPosteriorShift(model);
      var correct = predictionChoice === actual;
      var relation = actual === "same" ? "about the same as" : actual + " than";
      var message = "You predicted " + predictionLabel(predictionChoice) + "; posterior is " + relation + " prior.";
      setPredictionFeedbackMessage(message, correct ? "is-correct" : "is-incorrect");
    }

    function getSerializableState() {
      return {
        prior: state.prior,
        tGivenR: state.tGivenR,
        tGivenNotR: state.tGivenNotR,
        decisionThreshold: decisionState.threshold,
        falsePositiveCost: decisionState.falsePositiveCost,
        falseNegativeCost: decisionState.falseNegativeCost,
        useCostThreshold: decisionState.useCostThreshold
      };
    }

    function setCopyLinkStatus(message) {
      if (copyLinkStatus) {
        copyLinkStatus.textContent = message || "";
      }
      if (announcer && message) {
        announcer.textContent = message;
      }
      if (copyLinkStatusTimer !== null) {
        clearTimeout(copyLinkStatusTimer);
      }
      if (message) {
        copyLinkStatusTimer = setTimeout(function () {
          if (copyLinkStatus) {
            copyLinkStatus.textContent = "";
          }
          copyLinkStatusTimer = null;
        }, 1800);
      }
    }

    function fallbackCopyText(text) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      var copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (error) {
        copied = false;
      }

      document.body.removeChild(textarea);
      return copied;
    }

    function copyShareLink() {
      writeHash(getSerializableState());
      var url = window.location.href;
      var hasClipboard = navigator.clipboard && typeof navigator.clipboard.writeText === "function";
      var isSecureCopyContext = !!(window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      if (hasClipboard && isSecureCopyContext) {
        navigator.clipboard.writeText(url).then(function () {
          setCopyLinkStatus("Link copied.");
        }).catch(function () {
          var copiedFallback = fallbackCopyText(url);
          setCopyLinkStatus(copiedFallback ? "Link copied." : "Copy failed. Copy from address bar.");
        });
        return;
      }

      var copied = fallbackCopyText(url);
      setCopyLinkStatus(copied ? "Link copied." : "Copy failed. Copy from address bar.");
    }

    function shouldPersistHash() {
      return unlockStep >= 3;
    }

    function updateActivePresetFromManualInput() {
      if (activePresetKey && !statesMatchPreset(state, window.RainModel.PRESETS[activePresetKey])) {
        activePresetKey = null;
      }
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
      posteriorBarValue.textContent = percent(model.posterior);

      summary.textContent = "";

      advancedPt.textContent = fixed(model.pTestimony, 3);
      advancedNum.textContent = fixed(model.numerator, 3);
      advancedPost.textContent = fixed(model.posterior, 3);
      advancedEvidence.textContent = fixed(model.logEvidence, 3);
      advancedKl.textContent = fixed(model.klUpdateCost, 3);

      updateLossReadout(model);
      updateRainPreview(model);
      if (conditionalViz && typeof conditionalViz.update === "function") {
        conditionalViz.update({
          prior: model.prior,
          tGivenR: model.tGivenR,
          tGivenNotR: model.tGivenNotR,
          posterior: model.posterior,
          replayStep: replay.step,
          reducedMotion: prefersReducedMotion
        });
      }
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
        writeHash(getSerializableState());
      }

      if (opts.announce) {
        announcePosterior("Updated posterior rain chance: " + percent(model.posterior) + ".");
      }
    }

    function cancelScheduledInputRender() {
      if (inputRenderRafId !== null) {
        window.cancelAnimationFrame(inputRenderRafId);
        inputRenderRafId = null;
      }
    }

    function scheduleInputRender() {
      if (inputRenderRafId !== null) {
        return;
      }
      inputRenderRafId = window.requestAnimationFrame(function () {
        inputRenderRafId = null;
        render({ resampleParticles: false, animateParticles: false });
      });
    }

    function setState(nextState, options) {
      var opts = options || {};
      cancelScheduledInputRender();

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
      markPredictionPending();
      syncSliderVisuals();
      scheduleInputRender();
    }

    function onSliderCommit(key, value) {
      var previousPosterior = window.RainModel.deriveState(state).posterior;
      cancelScheduledInputRender();
      cancelReplay("slider-commit", { keepVisualState: false, keepProgress: false });
      state[key] = Number(value);
      updateActivePresetFromManualInput();
      syncSliderVisuals();
      render({ announce: true, resampleParticles: true, animateParticles: true });
      resolvePrediction(window.RainModel.deriveState(state));
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
        cancelScheduledInputRender();
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
        resolvePrediction(window.RainModel.deriveState(state));
        pulseRainPreview("testimony", previousPosterior, window.RainModel.deriveState(state).posterior);
      });
    });

    if (decisionThresholdSlider) {
      decisionThresholdSlider.addEventListener("input", function () {
        cancelScheduledInputRender();
        cancelReplay("threshold-input", { keepVisualState: false, keepProgress: false });
        decisionState.useCostThreshold = false;
        decisionState.threshold = clamp01(decisionThresholdSlider.value);
        updateSliderVisual(decisionThresholdSlider);
        setThresholdVisual();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
      });
      decisionThresholdSlider.addEventListener("change", function () {
        cancelScheduledInputRender();
        decisionState.useCostThreshold = false;
        decisionState.threshold = clamp01(decisionThresholdSlider.value);
        updateSliderVisual(decisionThresholdSlider);
        setThresholdVisual();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
        announcePosterior("Decision threshold set to " + percent(decisionState.threshold) + ".");
      });
    }

    if (decisionUseCosts) {
      decisionUseCosts.addEventListener("change", function () {
        cancelScheduledInputRender();
        cancelReplay("cost-toggle", { keepVisualState: false, keepProgress: false });
        decisionState.useCostThreshold = !!decisionUseCosts.checked;
        refreshThresholdFromCosts();
        setThresholdVisual();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
        announcePosterior("Cost-based threshold " + (decisionState.useCostThreshold ? "enabled" : "disabled") + ".");
      });
    }

    if (costFalsePositive) {
      costFalsePositive.addEventListener("input", function () {
        cancelScheduledInputRender();
        cancelReplay("cost-input", { keepVisualState: false, keepProgress: false });
        decisionState.falsePositiveCost = Math.max(0.1, Number(costFalsePositive.value));
        updateSliderVisual(costFalsePositive);
        if (decisionState.useCostThreshold) {
          refreshThresholdFromCosts();
        }
        setThresholdVisual();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
      });
      costFalsePositive.addEventListener("change", function () {
        cancelScheduledInputRender();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
        announcePosterior("Costs updated.");
      });
    }

    if (costFalseNegative) {
      costFalseNegative.addEventListener("input", function () {
        cancelScheduledInputRender();
        cancelReplay("cost-input", { keepVisualState: false, keepProgress: false });
        decisionState.falseNegativeCost = Math.max(0.1, Number(costFalseNegative.value));
        updateSliderVisual(costFalseNegative);
        if (decisionState.useCostThreshold) {
          refreshThresholdFromCosts();
        }
        setThresholdVisual();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
      });
      costFalseNegative.addEventListener("change", function () {
        cancelScheduledInputRender();
        render({ announce: false, persistHash: true, resampleParticles: false, animateParticles: false });
        announcePosterior("Costs updated.");
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        var previousPosterior = window.RainModel.deriveState(state).posterior;
        cancelScheduledInputRender();
        cancelReplay("reset", { keepVisualState: false, keepProgress: false });
        var preset = window.RainModel.PRESETS.canonical;
        decisionState.threshold = DEFAULT_DECISION_THRESHOLD;
        decisionState.useCostThreshold = false;
        decisionState.falsePositiveCost = DEFAULT_FALSE_POSITIVE_COST;
        decisionState.falseNegativeCost = DEFAULT_FALSE_NEGATIVE_COST;
        setThresholdVisual();
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
        resolvePrediction(window.RainModel.deriveState(state));
        pulseRainPreview("testimony", previousPosterior, window.RainModel.deriveState(state).posterior);
      });
    }

    predictionButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        cancelScheduledInputRender();
        cancelReplay("prediction-choice", { keepVisualState: false, keepProgress: false });
        predictionChoice = button.getAttribute("data-predict");
        syncPredictionButtons();
        markPredictionPending();
      });
    });

    if (copyLinkButton) {
      copyLinkButton.addEventListener("click", function () {
        cancelScheduledInputRender();
        copyShareLink();
      });
    }

    if (replayPlay) {
      replayPlay.addEventListener("click", function () {
        cancelScheduledInputRender();
        startReplay();
      });
    }

    if (replayPrev) {
      replayPrev.addEventListener("click", function () {
        cancelScheduledInputRender();
        var current = replay.step === null ? 1 : replay.step;
        jumpToReplayStep(current - 1);
      });
    }

    if (replayNext) {
      replayNext.addEventListener("click", function () {
        cancelScheduledInputRender();
        var current = replay.step === null ? 1 : replay.step;
        jumpToReplayStep(current + 1);
      });
    }

    replayStepButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        cancelScheduledInputRender();
        jumpToReplayStep(Number(button.getAttribute("data-replay-step")));
      });
    });

    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && replay.mode === "playing") {
        event.preventDefault();
        cancelScheduledInputRender();
        cancelReplay("escape", { keepVisualState: false, keepProgress: false });
        render({ persistHash: false, resampleParticles: false, animateParticles: false });
      }
    });

    window.addEventListener("beforeunload", function () {
      cancelScheduledInputRender();
      if (rainPreview && typeof rainPreview.destroy === "function") {
        rainPreview.destroy();
      }
      rainPreview = null;
      if (conditionalViz && typeof conditionalViz.destroy === "function") {
        conditionalViz.destroy();
      }
      conditionalViz = null;
    });

    bindUnlocking(setUnlockStep);

    syncSliders();
    syncPredictionButtons();
    markPredictionPending();
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
