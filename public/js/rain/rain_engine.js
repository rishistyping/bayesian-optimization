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
  var REPLAY_STEP_HOLD_MS = { 1: 950, 2: 950, 3: 950, 4: 950, 5: 900 };
  var REPLAY_STEP_HOLD_MS_REDUCED = { 1: 420, 2: 420, 3: 420, 4: 420, 5: 420 };
  var REPLAY_TRANSITION_MS = 420;
  var REPLAY_TRANSITION_MS_REDUCED = 120;
  var REPLAY_PARTICLE_DRIFT_MS = 760;
  var REPLAY_PARTICLE_DRIFT_MS_REDUCED = 0;
  var REPLAY_PROGRESS_TICK_MS = 50;
  var REPLAY_LOOP_GAP_MS = 220;
  var RAIN_PREVIEW_EVIDENCE_BITS = 1.5;
  var RAIN_PREVIEW_LARGE_DELTA = 0.06;
  var FACTOR_STAGES = ["perception", "memory", "honesty", "communication"];
  var DEFAULT_SECOND_SIGNAL_GIVEN_R = 0.92;
  var DEFAULT_SECOND_SIGNAL_GIVEN_NOT_R = 0.08;
  var DEFAULT_UNLOCK_STEP = 5;

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

  function factorProduct(factors) {
    if (!factors) {
      return 0;
    }
    var keys = FACTOR_STAGES;
    var product = 1;
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      product *= clamp01(factors[key]);
    }
    return clamp01(product);
  }

  function seededFactorsFromTotal(total) {
    var safe = clamp01(total);
    var root = Math.pow(Math.max(1e-6, safe), 1 / FACTOR_STAGES.length);
    return {
      perception: root,
      memory: root,
      honesty: root,
      communication: root
    };
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

    var channelMode = params.get("cm");
    if (channelMode === "simple" || channelMode === "factorized") {
      partial.channelMode = channelMode;
      hasAny = true;
    }

    var hitFactorMap = {
      perception: "rhp",
      memory: "rhm",
      honesty: "rhh",
      communication: "rhc"
    };
    var falseFactorMap = {
      perception: "rfp",
      memory: "rfm",
      honesty: "rfh",
      communication: "rfc"
    };
    var hitFactors = {};
    var falseFactors = {};
    var hitFactorFound = false;
    var falseFactorFound = false;
    FACTOR_STAGES.forEach(function (stage) {
      var hitValue = parseHashNumber(params.get(hitFactorMap[stage]));
      if (hitValue !== null) {
        hitFactors[stage] = hitValue;
        hitFactorFound = true;
      }
      var falseValue = parseHashNumber(params.get(falseFactorMap[stage]));
      if (falseValue !== null) {
        falseFactors[stage] = falseValue;
        falseFactorFound = true;
      }
    });
    if (hitFactorFound) {
      partial.hitFactors = hitFactors;
      hasAny = true;
    }
    if (falseFactorFound) {
      partial.falseFactors = falseFactors;
      hasAny = true;
    }

    var sGivenR = parseHashNumber(params.get("sgr"));
    if (sGivenR !== null) {
      partial.sGivenR = sGivenR;
      hasAny = true;
    }
    var sGivenNotR = parseHashNumber(params.get("sgnr"));
    if (sGivenNotR !== null) {
      partial.sGivenNotR = sGivenNotR;
      hasAny = true;
    }

    var observation = params.get("so");
    if (observation === "none" || observation === "saw_rain" || observation === "saw_no_rain") {
      partial.observation = observation;
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
    params.set("cm", state.channelMode === "factorized" ? "factorized" : "simple");

    var hitFactorMap = {
      perception: "rhp",
      memory: "rhm",
      honesty: "rhh",
      communication: "rhc"
    };
    var falseFactorMap = {
      perception: "rfp",
      memory: "rfm",
      honesty: "rfh",
      communication: "rfc"
    };
    FACTOR_STAGES.forEach(function (stage) {
      params.set(hitFactorMap[stage], fixed(state.hitFactors[stage], 2));
      params.set(falseFactorMap[stage], fixed(state.falseFactors[stage], 2));
    });

    params.set("sgr", fixed(state.sGivenR, 2));
    params.set("sgnr", fixed(state.sGivenNotR, 2));
    params.set("so", state.observation);

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
    var post1Bar = root.querySelector("#post1-bar");
    var post1BarValue = root.querySelector("#post1-bar-value");
    var testimonyStrip = root.querySelector("#testimony-strip");
    var secondSignalStrip = root.querySelector("#second-signal-strip");
    var posteriorTrack = root.querySelector(".posterior-track");
    var posteriorParticlesSvg = root.querySelector("#posterior-particles");
    var thresholdMarker = root.querySelector("#decision-threshold");
    var posteriorGhost = root.querySelector("#posterior-ghost");
    var posteriorBar = root.querySelector("#posterior-bar");
    var posteriorBarValue = root.querySelector("#posterior-bar-value");

    var summary = root.querySelector("#posterior-live");
    var plainEnglishRecap = root.querySelector("#plain-english-recap");
    var announcer = root.querySelector("#posterior-live-announcer");
    var engineMotionNote = root.querySelector("#engine-motion-note");

    var advancedPt = root.querySelector("#advanced-pt");
    var advancedNum = root.querySelector("#advanced-num");
    var advancedPt2 = root.querySelector("#advanced-pt2");
    var advancedNum2 = root.querySelector("#advanced-num2");
    var advancedPost1 = root.querySelector("#advanced-post1");
    var advancedPost = root.querySelector("#advanced-post");
    var advancedEvidence1 = root.querySelector("#advanced-evidence-1");
    var advancedEvidence2 = root.querySelector("#advanced-evidence-2");
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
    var secondSignalObservation = root.querySelector("#second-signal-observation");
    var secondSignalTrueSlider = root.querySelector("#second-signal-true-slider");
    var secondSignalTrueValue = root.querySelector("#second-signal-true-value");
    var secondSignalFalseSlider = root.querySelector("#second-signal-false-slider");
    var secondSignalFalseValue = root.querySelector("#second-signal-false-value");
    var twoStepPrior = root.querySelector("#two-step-prior");
    var twoStepPost1 = root.querySelector("#two-step-post1");
    var twoStepPost2 = root.querySelector("#two-step-post2");
    var channelModeSimple = root.querySelector("#channel-mode-simple");
    var channelModeFactorized = root.querySelector("#channel-mode-factorized");
    var channelSimpleControls = Array.prototype.slice.call(root.querySelectorAll(".channel-simple-control"));
    var factorizedPanel = root.querySelector("#factorized-channel-panel");
    var factorHitTotal = root.querySelector("#factor-hit-total");
    var factorFalseTotal = root.querySelector("#factor-false-total");
    var likelihoodRatioValue = root.querySelector("#likelihood-ratio-value");
    var pipelineTruth = root.querySelector("#pipeline-truth");
    var pipelineChannel = root.querySelector("#pipeline-channel");
    var pipelineSignal = root.querySelector("#pipeline-signal");
    var pipelineUpdate = root.querySelector("#pipeline-update");
    var pipelineDetail = root.querySelector("#pipeline-detail");
    var evidenceSummaryBits = root.querySelector("#evidence-summary-bits");
    var evidenceSummaryKl = root.querySelector("#evidence-summary-kl");
    var evidenceSummaryShift = root.querySelector("#evidence-summary-shift");
    var scenarioCompareCard = root.querySelector("#scenario-compare-card");
    var scenarioCompareCurrent = root.querySelector("#scenario-compare-current");
    var scenarioCompareCanonical = root.querySelector("#scenario-compare-canonical");
    var scenarioCompareVeryReliable = root.querySelector("#scenario-compare-very-reliable");
    var scenarioCompareUnreliable = root.querySelector("#scenario-compare-unreliable");
    var scenarioCompareCurrentBar = root.querySelector("#scenario-compare-current-bar");
    var scenarioCompareCanonicalBar = root.querySelector("#scenario-compare-canonical-bar");
    var scenarioCompareVeryReliableBar = root.querySelector("#scenario-compare-very-reliable-bar");
    var scenarioCompareUnreliableBar = root.querySelector("#scenario-compare-unreliable-bar");
    var secondSignalCtaRain = root.querySelector("#second-signal-cta-rain");
    var secondSignalCtaNoRain = root.querySelector("#second-signal-cta-no-rain");
    var secondSignalCtaClear = root.querySelector("#second-signal-cta-clear");
    var formulaLevelButtons = Array.prototype.slice.call(root.querySelectorAll("button[data-formula-level]"));
    var formulaPanelBasic = root.querySelector("#formula-panel-basic");
    var formulaPanelSymbolic = root.querySelector("#formula-panel-symbolic");
    var formulaPanelDerived = root.querySelector("#formula-panel-derived");

    var hitFactorSliders = {
      perception: root.querySelector("#hit-perception-slider"),
      memory: root.querySelector("#hit-memory-slider"),
      honesty: root.querySelector("#hit-honesty-slider"),
      communication: root.querySelector("#hit-communication-slider")
    };
    var falseFactorSliders = {
      perception: root.querySelector("#false-perception-slider"),
      memory: root.querySelector("#false-memory-slider"),
      honesty: root.querySelector("#false-honesty-slider"),
      communication: root.querySelector("#false-communication-slider")
    };
    var hitFactorOutputs = {
      perception: root.querySelector("#hit-perception-value"),
      memory: root.querySelector("#hit-memory-value"),
      honesty: root.querySelector("#hit-honesty-value"),
      communication: root.querySelector("#hit-communication-value")
    };
    var falseFactorOutputs = {
      perception: root.querySelector("#false-perception-value"),
      memory: root.querySelector("#false-memory-value"),
      honesty: root.querySelector("#false-honesty-value"),
      communication: root.querySelector("#false-communication-value")
    };
    var rainPreviewMount = root.querySelector("#rain-preview");
    var rainPreviewProb = root.querySelector("#rain-preview-prob");
    var rainPreviewCertainty = root.querySelector("#rain-preview-certainty");
    var conditionalPanel = document.getElementById("conditional-probability-panel");
    var conditionalMotionNote = document.getElementById("cp-motion-note");
    var copyLinkButton = root.querySelector("#copy-link-btn");
    var copyLinkStatus = root.querySelector("#copy-link-status");

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
    var formulaLevel = "basic";
    var copyLinkStatusTimer = null;
    var inputRenderRafId = null;
    var sliderVisualInputs = [
      priorSlider,
      truthSlider,
      falseSlider,
      decisionThresholdSlider,
      costFalsePositive,
      costFalseNegative,
      secondSignalTrueSlider,
      secondSignalFalseSlider,
      hitFactorSliders.perception,
      hitFactorSliders.memory,
      hitFactorSliders.honesty,
      hitFactorSliders.communication,
      falseFactorSliders.perception,
      falseFactorSliders.memory,
      falseFactorSliders.honesty,
      falseFactorSliders.communication
    ].filter(Boolean);

    // Keep chapter controls enabled on first load; state still starts from canonical preset values.
    var unlockStep = DEFAULT_UNLOCK_STEP;
    var state = {
      prior: window.RainModel.PRESETS.canonical.prior,
      tGivenR: window.RainModel.PRESETS.canonical.tGivenR,
      tGivenNotR: window.RainModel.PRESETS.canonical.tGivenNotR
    };
    var channelState = {
      mode: "simple",
      hitFactors: seededFactorsFromTotal(state.tGivenR),
      falseFactors: seededFactorsFromTotal(state.tGivenNotR)
    };
    var secondSignalState = {
      observation: "none",
      sGivenR: DEFAULT_SECOND_SIGNAL_GIVEN_R,
      sGivenNotR: DEFAULT_SECOND_SIGNAL_GIVEN_NOT_R
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
      if (hashPartial.channelMode === "simple" || hashPartial.channelMode === "factorized") {
        channelState.mode = hashPartial.channelMode;
      }
      if (hashPartial.hitFactors) {
        FACTOR_STAGES.forEach(function (stage) {
          if (hashPartial.hitFactors[stage] !== undefined) {
            channelState.hitFactors[stage] = clamp01(hashPartial.hitFactors[stage]);
          }
        });
      }
      if (hashPartial.falseFactors) {
        FACTOR_STAGES.forEach(function (stage) {
          if (hashPartial.falseFactors[stage] !== undefined) {
            channelState.falseFactors[stage] = clamp01(hashPartial.falseFactors[stage]);
          }
        });
      }
      if (hashPartial.sGivenR !== undefined) {
        secondSignalState.sGivenR = clamp01(hashPartial.sGivenR);
      }
      if (hashPartial.sGivenNotR !== undefined) {
        secondSignalState.sGivenNotR = clamp01(hashPartial.sGivenNotR);
      }
      if (hashPartial.observation) {
        secondSignalState.observation = hashPartial.observation;
      }
    }

    if (channelState.mode === "factorized") {
      if (!(hashPartial && hashPartial.hitFactors)) {
        channelState.hitFactors = seededFactorsFromTotal(state.tGivenR);
      }
      if (!(hashPartial && hashPartial.falseFactors)) {
        channelState.falseFactors = seededFactorsFromTotal(state.tGivenNotR);
      }
      state.tGivenR = factorProduct(channelState.hitFactors);
      state.tGivenNotR = factorProduct(channelState.falseFactors);
    }
    particles = createParticles(state.prior, PARTICLE_COUNT);

    var activePresetKey = getMatchingPresetKey(state);

    if (window.RainPreviewD3 && typeof window.RainPreviewD3.init === "function" && rainPreviewMount) {
      rainPreview = window.RainPreviewD3.init(rainPreviewMount, {
        maxDrops: PARTICLE_COUNT,
        panelMin: 280,
        panelMax: 360,
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
    var post1Row = post1Bar ? post1Bar.closest(".bar-row") : null;
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
        replayNext.disabled = step === null ? true : step >= 5;
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
      return p.stepHold[1] + p.stepHold[2] + p.stepHold[3] + p.stepHold[4] + p.stepHold[5];
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
        applyReplayStep(5, { animated: true });
      }, hold[1] + hold[2] + hold[3] + hold[4], runId);

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
      if (post1Bar) {
        post1Bar.classList.remove("is-hidden");
        post1Bar.style.transitionDuration = "";
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
      if (post1Row) {
        post1Row.classList.remove("is-highlight");
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
        if (post1Bar) {
          post1Bar.classList.toggle("is-hidden", opts.showPost1 === false);
          if (hasTransition) {
            post1Bar.style.transitionDuration = Math.max(0, transitionMs) + "ms";
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
        if (post1Row) {
          post1Row.classList.toggle("is-highlight", !!opts.highlightPost1);
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
          if (post1BarValue) {
            post1BarValue.classList.add("is-hidden-text");
            post1BarValue.textContent = "hidden";
          }
          posteriorBarValue.classList.add("is-hidden-text");
          posteriorBarValue.textContent = "hidden";
          if (advancedPost1) {
            advancedPost1.textContent = "hidden until update";
          }
          advancedPost.textContent = "hidden until update";
          if (advancedEvidence1) {
            advancedEvidence1.textContent = "hidden until update";
          }
          if (advancedEvidence2) {
            advancedEvidence2.textContent = "hidden until update";
          }
          advancedEvidence.textContent = "hidden until update";
          advancedKl.textContent = "hidden until update";
          return;
        }

        if (post1BarValue) {
          post1BarValue.classList.remove("is-hidden-text");
          post1BarValue.textContent = percent(model.posteriorAfterTestimony);
        }
        posteriorBarValue.classList.remove("is-hidden-text");
        posteriorBarValue.textContent = percent(model.posteriorAfterSecondSignal);
        if (advancedPost1) {
          advancedPost1.textContent = fixed(model.posteriorAfterTestimony, 3);
        }
        advancedPost.textContent = fixed(model.posteriorAfterSecondSignal, 3);
        if (advancedEvidence1) {
          advancedEvidence1.textContent = fixed(model.stepEvidenceBits.testimony, 3);
        }
        if (advancedEvidence2) {
          advancedEvidence2.textContent = fixed(model.stepEvidenceBits.secondSignal, 3);
        }
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
      var replayStep = Math.max(1, Math.min(5, Number(step) || 1));
      var previousReplayStep = replay.step;
      var profile = getReplayProfile();
      var model = currentModel();
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
          showPost1: false,
          showPosterior: false,
          highlightPost1: false,
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
        summary.textContent = "Step 1/5: Start with your prior belief before testimony.";
        return;
      }

      if (replayStep === 2) {
        CurvesViz.setVisibility({
          ghostPrior: false,
          subdueLikelihood: false,
          showPost1: false,
          showPosterior: false,
          highlightPost1: false,
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
        summary.textContent = "Step 2/5: Inspect testimony as a reliability-weighted channel.";
        return;
      }

      if (replayStep === 3) {
        CurvesViz.setVisibility({
          ghostPrior: false,
          subdueLikelihood: false,
          showPost1: true,
          showPosterior: false,
          highlightPost1: true,
          highlightPosterior: false,
          transitionMs: profile.transitionMs
        });
        GaugesViz.update(model, { hidePosterior: false });
        ParticlesViz.playDriftToPosterior({
          priorMean: model.prior,
          posterior: model.posteriorAfterTestimony,
          fromPrior: true,
          animate: shouldAnimate,
          durationMs: profile.particleDriftMs
        });
        pulseRainPreview("replay", model.prior, model.posteriorAfterTestimony);
        if (conditionalViz) {
          if (typeof conditionalViz.setPerspective === "function") {
            conditionalViz.setPerspective("testimony", { animate: shouldAnimate, source: "replay", mode: "staged" });
          }
          if (typeof conditionalViz.setHighlightedEvent === "function") {
            conditionalViz.setHighlightedEvent("testimony");
          }
        }
        summary.textContent = "Step 3/5: Apply Bayes once to get posterior after testimony.";
        return;
      }

      if (replayStep === 4) {
        CurvesViz.setVisibility({
          ghostPrior: true,
          subdueLikelihood: false,
          showPost1: true,
          showPosterior: true,
          highlightPost1: false,
          highlightPosterior: true,
          transitionMs: profile.transitionMs
        });
        GaugesViz.update(model, { hidePosterior: false });
        ParticlesViz.playDriftToPosterior({
          priorMean: model.posteriorAfterTestimony,
          posterior: model.posteriorAfterSecondSignal,
          fromPrior: true,
          animate: shouldAnimate,
          durationMs: profile.particleDriftMs
        });
        pulseRainPreview("replay", model.posteriorAfterTestimony, model.posteriorAfterSecondSignal);
        if (conditionalViz) {
          if (typeof conditionalViz.setPerspective === "function") {
            conditionalViz.setPerspective("testimony", { animate: false, source: "replay", mode: "direct" });
          }
          if (typeof conditionalViz.setHighlightedEvent === "function") {
            conditionalViz.setHighlightedEvent(null);
          }
        }
        summary.textContent = "Step 4/5: Apply the second signal from looking outside.";
        return;
      }

      CurvesViz.setVisibility({
        ghostPrior: true,
        subdueLikelihood: false,
        showPost1: true,
        showPosterior: true,
        highlightPost1: false,
        highlightPosterior: true,
        transitionMs: profile.transitionMs
      });
      GaugesViz.update(model, { hidePosterior: false });
      ParticlesViz.playDriftToPosterior({
        priorMean: model.posteriorAfterSecondSignal,
        posterior: model.posteriorAfterSecondSignal,
        fromPrior: false,
        resample: previousReplayStep !== 4,
        animate: false,
        durationMs: 0
      });
      DecisionViz.setDecisionState(model.posteriorAfterSecondSignal, { emphasize: true });
      DecisionViz.flashThreshold();
      if (conditionalViz) {
        if (typeof conditionalViz.setPerspective === "function") {
          conditionalViz.setPerspective("testimony", { animate: false, source: "replay", mode: "direct" });
        }
        if (typeof conditionalViz.setHighlightedEvent === "function") {
          conditionalViz.setHighlightedEvent(null);
        }
      }
      summary.textContent = "Step 5/5: Compare final posterior to threshold and choose the action.";
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
      replay.step = Math.max(1, Math.min(5, Number(step) || 1));
      setReplayProgress((replay.step - 1) / 4);
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
      syncChannelModeControls();
      syncFactorControls();
      syncSecondSignalControls();
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

    function getSerializableState() {
      return {
        prior: state.prior,
        tGivenR: state.tGivenR,
        tGivenNotR: state.tGivenNotR,
        decisionThreshold: decisionState.threshold,
        falsePositiveCost: decisionState.falsePositiveCost,
        falseNegativeCost: decisionState.falseNegativeCost,
        useCostThreshold: decisionState.useCostThreshold,
        channelMode: channelState.mode,
        hitFactors: channelState.hitFactors,
        falseFactors: channelState.falseFactors,
        sGivenR: secondSignalState.sGivenR,
        sGivenNotR: secondSignalState.sGivenNotR,
        observation: secondSignalState.observation
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
        rainPreviewProb.textContent = "P(rain | current evidence) = " + fixed(model.posterior, 2);
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

    function setActivePipelineStage(stage) {
      var stages = [
        { key: "truth", el: pipelineTruth },
        { key: "channel", el: pipelineChannel },
        { key: "signal", el: pipelineSignal },
        { key: "update", el: pipelineUpdate }
      ];
      stages.forEach(function (item) {
        if (!item.el) {
          return;
        }
        item.el.classList.toggle("is-active", item.key === stage);
      });
    }

    function observationLabel(observation) {
      if (observation === "saw_rain") {
        return "saw rain";
      }
      if (observation === "saw_no_rain") {
        return "saw no rain";
      }
      return "not applied";
    }

    function signedPercentagePoints(delta) {
      var value = Number(delta) * 100;
      if (!Number.isFinite(value)) {
        value = 0;
      }
      if (Math.abs(value) < 0.05) {
        value = 0;
      }
      return (value >= 0 ? "+" : "") + fixed(value, 1) + " pp";
    }

    function syncChannelModeControls() {
      var isFactorized = channelState.mode === "factorized";
      if (channelModeSimple) {
        channelModeSimple.checked = !isFactorized;
      }
      if (channelModeFactorized) {
        channelModeFactorized.checked = isFactorized;
      }
      channelSimpleControls.forEach(function (section) {
        section.hidden = isFactorized;
      });
      if (factorizedPanel) {
        factorizedPanel.hidden = !isFactorized;
      }
    }

    function syncFactorControls() {
      FACTOR_STAGES.forEach(function (stage) {
        var hitSlider = hitFactorSliders[stage];
        if (hitSlider) {
          hitSlider.value = fixed(channelState.hitFactors[stage], 2);
        }
        var hitOutput = hitFactorOutputs[stage];
        if (hitOutput) {
          hitOutput.textContent = fixed(channelState.hitFactors[stage], 2);
        }

        var falseSlider = falseFactorSliders[stage];
        if (falseSlider) {
          falseSlider.value = fixed(channelState.falseFactors[stage], 2);
        }
        var falseOutput = falseFactorOutputs[stage];
        if (falseOutput) {
          falseOutput.textContent = fixed(channelState.falseFactors[stage], 2);
        }
      });
    }

    function syncSecondSignalControls() {
      if (secondSignalObservation) {
        secondSignalObservation.value = secondSignalState.observation;
      }
      if (secondSignalTrueSlider) {
        secondSignalTrueSlider.value = fixed(secondSignalState.sGivenR, 2);
      }
      if (secondSignalTrueValue) {
        secondSignalTrueValue.textContent = percent(secondSignalState.sGivenR);
      }
      if (secondSignalFalseSlider) {
        secondSignalFalseSlider.value = fixed(secondSignalState.sGivenNotR, 2);
      }
      if (secondSignalFalseValue) {
        secondSignalFalseValue.textContent = percent(secondSignalState.sGivenNotR);
      }
      if (secondSignalCtaRain) {
        secondSignalCtaRain.setAttribute("aria-pressed", secondSignalState.observation === "saw_rain" ? "true" : "false");
      }
      if (secondSignalCtaNoRain) {
        secondSignalCtaNoRain.setAttribute("aria-pressed", secondSignalState.observation === "saw_no_rain" ? "true" : "false");
      }
      if (secondSignalCtaClear) {
        secondSignalCtaClear.setAttribute("aria-pressed", secondSignalState.observation === "none" ? "true" : "false");
      }
    }

    function updateEvidenceSummary(model) {
      if (evidenceSummaryBits) {
        evidenceSummaryBits.textContent = fixed(model.logEvidence, 3);
      }
      if (evidenceSummaryKl) {
        evidenceSummaryKl.textContent = fixed(model.klUpdateCost, 3);
      }
      if (evidenceSummaryShift) {
        evidenceSummaryShift.textContent = signedPercentagePoints(model.posteriorAfterSecondSignal - model.prior);
      }
    }

    function testimonyOnlyPosterior(prior, tGivenR, tGivenNotR) {
      var sample = window.RainModel.deriveSequentialState({
        prior: prior,
        tGivenR: tGivenR,
        tGivenNotR: tGivenNotR,
        sGivenR: DEFAULT_SECOND_SIGNAL_GIVEN_R,
        sGivenNotR: DEFAULT_SECOND_SIGNAL_GIVEN_NOT_R,
        observation: "none"
      });
      return clamp01(sample.posteriorAfterSecondSignal);
    }

    function updateScenarioComparison(model) {
      if (!scenarioCompareCard) {
        return;
      }

      scenarioCompareCard.title = "Comparison rows hold second signal off to isolate testimony quality.";
      var prior = clamp01(model.prior);
      var current = testimonyOnlyPosterior(prior, model.tGivenR, model.tGivenNotR);
      var canonical = testimonyOnlyPosterior(prior, window.RainModel.PRESETS.canonical.tGivenR, window.RainModel.PRESETS.canonical.tGivenNotR);
      var veryReliable = testimonyOnlyPosterior(prior, window.RainModel.PRESETS.very_reliable.tGivenR, window.RainModel.PRESETS.very_reliable.tGivenNotR);
      var unreliable = testimonyOnlyPosterior(prior, window.RainModel.PRESETS.unreliable.tGivenR, window.RainModel.PRESETS.unreliable.tGivenNotR);

      if (scenarioCompareCurrent) {
        scenarioCompareCurrent.textContent = percent(current);
      }
      if (scenarioCompareCanonical) {
        scenarioCompareCanonical.textContent = percent(canonical);
      }
      if (scenarioCompareVeryReliable) {
        scenarioCompareVeryReliable.textContent = percent(veryReliable);
      }
      if (scenarioCompareUnreliable) {
        scenarioCompareUnreliable.textContent = percent(unreliable);
      }

      if (scenarioCompareCurrentBar) {
        scenarioCompareCurrentBar.style.width = percent(current);
      }
      if (scenarioCompareCanonicalBar) {
        scenarioCompareCanonicalBar.style.width = percent(canonical);
      }
      if (scenarioCompareVeryReliableBar) {
        scenarioCompareVeryReliableBar.style.width = percent(veryReliable);
      }
      if (scenarioCompareUnreliableBar) {
        scenarioCompareUnreliableBar.style.width = percent(unreliable);
      }
    }

    function syncFormulaLevelUI() {
      var valid = { basic: true, symbolic: true, derived: true };
      if (!valid[formulaLevel]) {
        formulaLevel = "basic";
      }
      formulaLevelButtons.forEach(function (button) {
        var level = button.getAttribute("data-formula-level");
        var active = level === formulaLevel;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (formulaPanelBasic) {
        formulaPanelBasic.hidden = formulaLevel !== "basic";
      }
      if (formulaPanelSymbolic) {
        formulaPanelSymbolic.hidden = formulaLevel !== "symbolic";
      }
      if (formulaPanelDerived) {
        formulaPanelDerived.hidden = formulaLevel !== "derived";
      }
    }

    function setFormulaLevel(nextLevel, options) {
      var optsSet = options || {};
      var level = nextLevel === "symbolic" || nextLevel === "derived" ? nextLevel : "basic";
      formulaLevel = level;
      syncFormulaLevelUI();
      if (optsSet.focus) {
        var match = null;
        for (var i = 0; i < formulaLevelButtons.length; i += 1) {
          if (formulaLevelButtons[i].getAttribute("data-formula-level") === level) {
            match = formulaLevelButtons[i];
            break;
          }
        }
        if (match && typeof match.focus === "function") {
          match.focus();
        }
      }
    }

    function setSecondSignalObservation(nextObservation, options) {
      var optsSet = options || {};
      var observation = nextObservation === "saw_rain" || nextObservation === "saw_no_rain" ? nextObservation : "none";
      secondSignalState.observation = observation;
      syncSecondSignalControls();
      render({
        announce: optsSet.announce !== false,
        resampleParticles: !!optsSet.resampleParticles,
        animateParticles: !!optsSet.animateParticles
      });
    }

    function applyFactorizedRatesFromFactors() {
      state.tGivenR = factorProduct(channelState.hitFactors);
      state.tGivenNotR = factorProduct(channelState.falseFactors);
    }

    function reseedFactorsFromSimpleRates() {
      channelState.hitFactors = seededFactorsFromTotal(state.tGivenR);
      channelState.falseFactors = seededFactorsFromTotal(state.tGivenNotR);
    }

    function setChannelMode(nextMode, options) {
      var opts = options || {};
      var safeMode = nextMode === "factorized" ? "factorized" : "simple";
      if (channelState.mode === safeMode && !opts.force) {
        syncChannelModeControls();
        return;
      }
      channelState.mode = safeMode;
      if (safeMode === "factorized") {
        reseedFactorsFromSimpleRates();
        applyFactorizedRatesFromFactors();
      }
      syncChannelModeControls();
      syncFactorControls();
      syncSliders();
    }

    function currentModel() {
      return window.RainModel.deriveSequentialState({
        prior: state.prior,
        tGivenR: state.tGivenR,
        tGivenNotR: state.tGivenNotR,
        sGivenR: secondSignalState.sGivenR,
        sGivenNotR: secondSignalState.sGivenNotR,
        observation: secondSignalState.observation
      });
    }

    function updatePipelineDetail(model, replayStep) {
      if (!pipelineDetail) {
        return;
      }
      var stage = replayStep || 0;
      if (stage === 1) {
        setActivePipelineStage("truth");
        pipelineDetail.textContent = "Start from prior belief: " + percent(model.prior) + ".";
        return;
      }
      if (stage === 2) {
        setActivePipelineStage("channel");
        pipelineDetail.textContent = "Channel mode: " + (channelState.mode === "factorized" ? "factorized" : "simple") + ".";
        return;
      }
      if (stage === 3) {
        setActivePipelineStage("signal");
        pipelineDetail.textContent = "Step 1 testimony update moves belief to " + percent(model.posteriorAfterTestimony) + ".";
        return;
      }
      if (stage === 4) {
        setActivePipelineStage("update");
        pipelineDetail.textContent = "Step 2 observation update (" + observationLabel(secondSignalState.observation) + ") moves to " + percent(model.posteriorAfterSecondSignal) + ".";
        return;
      }
      if (stage === 5) {
        setActivePipelineStage("update");
        pipelineDetail.textContent = "Decision uses final posterior " + percent(model.posteriorAfterSecondSignal) + ".";
        return;
      }

      setActivePipelineStage("channel");
      pipelineDetail.textContent =
        "Effective channel: P(T|R)=" +
        fixed(model.tGivenR, 3) +
        ", P(T|¬R)=" +
        fixed(model.tGivenNotR, 3) +
        "; observation update: " +
        observationLabel(secondSignalState.observation) +
        ".";
    }

    function render(options) {
      var opts = options || {};
      var model = currentModel();

      priorValue.textContent = percent(model.prior);
      truthValue.textContent = percent(model.tGivenR);
      falseValue.textContent = percent(model.tGivenNotR);
      if (channelState.mode === "factorized") {
        syncFactorControls();
      }
      if (factorHitTotal) {
        factorHitTotal.textContent = fixed(model.tGivenR, 3);
      }
      if (factorFalseTotal) {
        factorFalseTotal.textContent = fixed(model.tGivenNotR, 3);
      }
      if (likelihoodRatioValue) {
        var lr = model.tGivenNotR > 0.001 ? model.tGivenR / model.tGivenNotR : model.tGivenR / 0.001;
        likelihoodRatioValue.textContent = fixed(lr, 2);
      }
      syncSecondSignalControls();

      priorBar.style.width = percent(model.prior);
      ptBar.style.width = percent(model.pTestimony);
      if (post1Bar) {
        post1Bar.style.width = percent(model.posteriorAfterTestimony);
      }
      if (posteriorGhost) {
        posteriorGhost.style.width = percent(model.posteriorAfterTestimony);
      }
      posteriorBar.style.width = percent(model.posteriorAfterSecondSignal);

      priorBarValue.textContent = percent(model.prior);
      ptBarValue.textContent = percent(model.pTestimony);
      if (post1BarValue) {
        post1BarValue.textContent = percent(model.posteriorAfterTestimony);
      }
      posteriorBarValue.textContent = percent(model.posteriorAfterSecondSignal);

      summary.textContent = "Testimony posterior " + percent(model.posteriorAfterTestimony) + ". Final posterior after looking " + percent(model.posteriorAfterSecondSignal) + ".";

      // Plain English recap
      if (plainEnglishRecap) {
        var priorPct = percent(model.prior);
        var postPct = percent(model.posteriorAfterSecondSignal);
        var hasObservation = model.observation && model.observation !== "none";
        var observationText = hasObservation ? "after looking outside" : "just from testimony";
        
        if (model.posteriorAfterSecondSignal > model.prior) {
          plainEnglishRecap.textContent = "You started at " + priorPct + " belief it was raining. After hearing your friend's testimony, you updated to " + postPct + " — Bayes forces this increase because the testimony was informative.";
        } else if (model.posteriorAfterSecondSignal < model.prior) {
          plainEnglishRecap.textContent = "You started at " + priorPct + " belief it was raining. After the evidence, you dropped to " + postPct + " — Bayes forces this decrease because the evidence outweighed the testimony.";
        } else {
          plainEnglishRecap.textContent = "Your belief remains at " + priorPct + " — the evidence was uninformative, so consistency requires no change.";
        }
      }

      if (testimonyStrip) {
        testimonyStrip.textContent = "Step 1: Testimony update. Friend says \"raining.\"";
      }
      if (secondSignalStrip) {
        secondSignalStrip.textContent = "Step 2: Observation update. " + observationLabel(secondSignalState.observation) + ".";
      }
      if (twoStepPrior) {
        twoStepPrior.textContent = percent(model.prior);
      }
      if (twoStepPost1) {
        twoStepPost1.textContent = percent(model.posteriorAfterTestimony);
      }
      if (twoStepPost2) {
        twoStepPost2.textContent = percent(model.posteriorAfterSecondSignal);
      }

      advancedPt.textContent = fixed(model.pTestimony, 3);
      advancedNum.textContent = fixed(model.numerator, 3);
      if (advancedPt2) {
        advancedPt2.textContent = fixed(model.pSecondSignalEvent, 3);
      }
      if (advancedNum2) {
        advancedNum2.textContent = fixed(model.secondSignalNumerator, 3);
      }
      if (advancedPost1) {
        advancedPost1.textContent = fixed(model.posteriorAfterTestimony, 3);
      }
      advancedPost.textContent = fixed(model.posteriorAfterSecondSignal, 3);
      if (advancedEvidence1) {
        advancedEvidence1.textContent = fixed(model.stepEvidenceBits.testimony, 3);
      }
      if (advancedEvidence2) {
        advancedEvidence2.textContent = fixed(model.stepEvidenceBits.secondSignal, 3);
      }
      advancedEvidence.textContent = fixed(model.logEvidence, 3);
      advancedKl.textContent = fixed(model.klUpdateCost, 3);
      updateEvidenceSummary(model);
      updateScenarioComparison(model);

      updateLossReadout(model);
      updateRainPreview(model);
      if (conditionalViz && typeof conditionalViz.update === "function") {
        conditionalViz.update({
          prior: model.prior,
          tGivenR: model.tGivenR,
          tGivenNotR: model.tGivenNotR,
          posterior: model.posteriorAfterTestimony,
          replayStep: replay.step,
          reducedMotion: prefersReducedMotion
        });
      }
      updatePipelineDetail(model, replay.step);
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

      if (channelState.mode === "factorized") {
        reseedFactorsFromSimpleRates();
        applyFactorizedRatesFromFactors();
      }

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
      syncSliderVisuals();
      scheduleInputRender();
    }

    function onSliderCommit(key, value) {
      var previousPosterior = currentModel().posteriorAfterSecondSignal;
      cancelScheduledInputRender();
      cancelReplay("slider-commit", { keepVisualState: false, keepProgress: false });
      state[key] = Number(value);
      updateActivePresetFromManualInput();
      syncSliderVisuals();
      render({ announce: true, resampleParticles: true, animateParticles: true });
      pulseRainPreview("testimony", previousPosterior, currentModel().posteriorAfterSecondSignal);
    }

    function onFactorSliderInput(pathKey, stage, value) {
      cancelReplay("factor-input", { keepVisualState: false, keepProgress: false });
      channelState[pathKey][stage] = clamp01(value);
      applyFactorizedRatesFromFactors();
      updateActivePresetFromManualInput();
      syncSliders();
      scheduleInputRender();
    }

    function onFactorSliderCommit(pathKey, stage, value) {
      var previousPosterior = currentModel().posteriorAfterSecondSignal;
      cancelScheduledInputRender();
      cancelReplay("factor-commit", { keepVisualState: false, keepProgress: false });
      channelState[pathKey][stage] = clamp01(value);
      applyFactorizedRatesFromFactors();
      updateActivePresetFromManualInput();
      syncSliders();
      render({ announce: true, resampleParticles: true, animateParticles: true });
      pulseRainPreview("testimony", previousPosterior, currentModel().posteriorAfterSecondSignal);
    }

    function onSecondSignalInput(key, value) {
      cancelReplay("second-signal-input", { keepVisualState: false, keepProgress: false });
      secondSignalState[key] = clamp01(value);
      syncSecondSignalControls();
      syncSliderVisuals();
      scheduleInputRender();
    }

    function onSecondSignalCommit(key, value) {
      var previousPosterior = currentModel().posteriorAfterSecondSignal;
      cancelScheduledInputRender();
      cancelReplay("second-signal-commit", { keepVisualState: false, keepProgress: false });
      secondSignalState[key] = clamp01(value);
      syncSecondSignalControls();
      syncSliderVisuals();
      render({ announce: true, resampleParticles: true, animateParticles: true });
      pulseRainPreview("testimony", previousPosterior, currentModel().posteriorAfterSecondSignal);
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

    if (channelModeSimple) {
      channelModeSimple.addEventListener("change", function () {
        if (!channelModeSimple.checked) {
          return;
        }
        cancelScheduledInputRender();
        cancelReplay("channel-mode", { keepVisualState: false, keepProgress: false });
        setChannelMode("simple");
        updateActivePresetFromManualInput();
        render({ announce: true, resampleParticles: false, animateParticles: false });
      });
    }

    if (channelModeFactorized) {
      channelModeFactorized.addEventListener("change", function () {
        if (!channelModeFactorized.checked) {
          return;
        }
        cancelScheduledInputRender();
        cancelReplay("channel-mode", { keepVisualState: false, keepProgress: false });
        setChannelMode("factorized");
        updateActivePresetFromManualInput();
        render({ announce: true, resampleParticles: false, animateParticles: false });
      });
    }

    FACTOR_STAGES.forEach(function (stage) {
      var hitSlider = hitFactorSliders[stage];
      if (hitSlider) {
        hitSlider.addEventListener("input", function () {
          onFactorSliderInput("hitFactors", stage, hitSlider.value);
        });
        hitSlider.addEventListener("change", function () {
          onFactorSliderCommit("hitFactors", stage, hitSlider.value);
        });
      }

      var falseSliderEl = falseFactorSliders[stage];
      if (falseSliderEl) {
        falseSliderEl.addEventListener("input", function () {
          onFactorSliderInput("falseFactors", stage, falseSliderEl.value);
        });
        falseSliderEl.addEventListener("change", function () {
          onFactorSliderCommit("falseFactors", stage, falseSliderEl.value);
        });
      }
    });

    if (secondSignalObservation) {
      secondSignalObservation.addEventListener("change", function () {
        cancelScheduledInputRender();
        cancelReplay("second-signal-observation", { keepVisualState: false, keepProgress: false });
        setSecondSignalObservation(secondSignalObservation.value, {
          announce: true,
          resampleParticles: false,
          animateParticles: false
        });
      });
    }

    if (secondSignalCtaRain) {
      secondSignalCtaRain.addEventListener("click", function () {
        cancelScheduledInputRender();
        cancelReplay("second-signal-cta", { keepVisualState: false, keepProgress: false });
        setSecondSignalObservation("saw_rain", {
          announce: true,
          resampleParticles: false,
          animateParticles: false
        });
      });
    }

    if (secondSignalCtaNoRain) {
      secondSignalCtaNoRain.addEventListener("click", function () {
        cancelScheduledInputRender();
        cancelReplay("second-signal-cta", { keepVisualState: false, keepProgress: false });
        setSecondSignalObservation("saw_no_rain", {
          announce: true,
          resampleParticles: false,
          animateParticles: false
        });
      });
    }

    if (secondSignalCtaClear) {
      secondSignalCtaClear.addEventListener("click", function () {
        cancelScheduledInputRender();
        cancelReplay("second-signal-cta", { keepVisualState: false, keepProgress: false });
        setSecondSignalObservation("none", {
          announce: true,
          resampleParticles: false,
          animateParticles: false
        });
      });
    }

    if (secondSignalTrueSlider) {
      secondSignalTrueSlider.addEventListener("input", function () {
        onSecondSignalInput("sGivenR", secondSignalTrueSlider.value);
      });
      secondSignalTrueSlider.addEventListener("change", function () {
        onSecondSignalCommit("sGivenR", secondSignalTrueSlider.value);
      });
    }

    if (secondSignalFalseSlider) {
      secondSignalFalseSlider.addEventListener("input", function () {
        onSecondSignalInput("sGivenNotR", secondSignalFalseSlider.value);
      });
      secondSignalFalseSlider.addEventListener("change", function () {
        onSecondSignalCommit("sGivenNotR", secondSignalFalseSlider.value);
      });
    }

    presetButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var previousPosterior = currentModel().posteriorAfterSecondSignal;
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
        pulseRainPreview("testimony", previousPosterior, currentModel().posteriorAfterSecondSignal);
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
        var previousPosterior = currentModel().posteriorAfterSecondSignal;
        cancelScheduledInputRender();
        cancelReplay("reset", { keepVisualState: false, keepProgress: false });
        var preset = window.RainModel.PRESETS.canonical;
        decisionState.threshold = DEFAULT_DECISION_THRESHOLD;
        decisionState.useCostThreshold = false;
        decisionState.falsePositiveCost = DEFAULT_FALSE_POSITIVE_COST;
        decisionState.falseNegativeCost = DEFAULT_FALSE_NEGATIVE_COST;
        channelState.mode = "simple";
        channelState.hitFactors = seededFactorsFromTotal(preset.tGivenR);
        channelState.falseFactors = seededFactorsFromTotal(preset.tGivenNotR);
        secondSignalState.observation = "none";
        secondSignalState.sGivenR = DEFAULT_SECOND_SIGNAL_GIVEN_R;
        secondSignalState.sGivenNotR = DEFAULT_SECOND_SIGNAL_GIVEN_NOT_R;
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
        pulseRainPreview("testimony", previousPosterior, currentModel().posteriorAfterSecondSignal);
      });
    }

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

    formulaLevelButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setFormulaLevel(button.getAttribute("data-formula-level"), { focus: false });
      });
      button.addEventListener("keydown", function (event) {
        var key = event.key;
        if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
          return;
        }
        event.preventDefault();
        if (!formulaLevelButtons.length) {
          return;
        }
        var currentIx = formulaLevelButtons.indexOf(button);
        if (currentIx < 0) {
          currentIx = 0;
        }
        var nextIx = currentIx;
        if (key === "ArrowRight") {
          nextIx = (currentIx + 1) % formulaLevelButtons.length;
        } else if (key === "ArrowLeft") {
          nextIx = (currentIx - 1 + formulaLevelButtons.length) % formulaLevelButtons.length;
        } else if (key === "Home") {
          nextIx = 0;
        } else if (key === "End") {
          nextIx = formulaLevelButtons.length - 1;
        }
        var nextButton = formulaLevelButtons[nextIx];
        if (!nextButton) {
          return;
        }
        setFormulaLevel(nextButton.getAttribute("data-formula-level"), { focus: true });
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
    syncFormulaLevelUI();
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
