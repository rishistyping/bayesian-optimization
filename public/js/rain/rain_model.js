(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RainModel = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  var EPS = 1e-12;

  var PRESETS = {
    canonical: {
      key: "canonical",
      label: "Casual friend",
      prior: 0.30,
      tGivenR: 0.85,
      tGivenNotR: 0.10
    },
    very_reliable: {
      key: "very_reliable",
      label: "Weather expert",
      prior: 0.30,
      tGivenR: 0.95,
      tGivenNotR: 0.02
    },
    unreliable: {
      key: "unreliable",
      label: "Friend who jokes",
      prior: 0.30,
      tGivenR: 0.60,
      tGivenNotR: 0.40
    }
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

  function evidence(prior, tGivenR, tGivenNotR) {
    var pRain = clamp01(prior);
    var pNotRain = 1 - pRain;
    var pTruth = clamp01(tGivenR);
    var pFalse = clamp01(tGivenNotR);
    return pTruth * pRain + pFalse * pNotRain;
  }

  function posterior(prior, tGivenR, tGivenNotR) {
    var pRain = clamp01(prior);
    var pTruth = clamp01(tGivenR);
    var pEvent = evidence(pRain, pTruth, tGivenNotR);

    if (pEvent <= EPS) {
      return pRain;
    }
    return (pTruth * pRain) / pEvent;
  }

  function applyObservation(prior, pObsGivenR, pObsGivenNotR) {
    return posterior(prior, pObsGivenR, pObsGivenNotR);
  }

  function safeLog2(value) {
    return Math.log(value) / Math.log(2);
  }

  function bernoulliKL(p, q) {
    var p1 = clamp01(p);
    var q1 = clamp01(q);

    if (Math.abs(p1 - q1) <= EPS) {
      return 0;
    }

    var a = Math.min(1 - EPS, Math.max(EPS, p1));
    var b = Math.min(1 - EPS, Math.max(EPS, q1));

    return a * safeLog2(a / b) + (1 - a) * safeLog2((1 - a) / (1 - b));
  }

  function deriveState(input) {
    var prior = clamp01(input.prior);
    var tGivenR = clamp01(input.tGivenR);
    var tGivenNotR = clamp01(input.tGivenNotR);

    var pTestimony = evidence(prior, tGivenR, tGivenNotR);
    var numerator = tGivenR * prior;
    var post = posterior(prior, tGivenR, tGivenNotR);

    var logEvidence;
    if (prior <= EPS || post <= EPS) {
      logEvidence = 0;
    } else {
      logEvidence = safeLog2(post / prior);
    }

    return {
      prior: prior,
      tGivenR: tGivenR,
      tGivenNotR: tGivenNotR,
      pTestimony: pTestimony,
      posterior: post,
      numerator: numerator,
      logEvidence: logEvidence,
      klUpdateCost: bernoulliKL(post, prior)
    };
  }

  function deriveSequentialState(input) {
    var prior = clamp01(input.prior);
    var tGivenR = clamp01(input.tGivenR);
    var tGivenNotR = clamp01(input.tGivenNotR);
    var sGivenR = clamp01(input.sGivenR);
    var sGivenNotR = clamp01(input.sGivenNotR);
    var observation = input.observation === "saw_no_rain" ? "saw_no_rain" : input.observation === "saw_rain" ? "saw_rain" : "none";

    var testimonyEvent = evidence(prior, tGivenR, tGivenNotR);
    var testimonyNumerator = tGivenR * prior;
    var postAfterTestimony = posterior(prior, tGivenR, tGivenNotR);

    var obsGivenR = sGivenR;
    var obsGivenNotR = sGivenNotR;
    if (observation === "saw_no_rain") {
      obsGivenR = 1 - sGivenR;
      obsGivenNotR = 1 - sGivenNotR;
    }

    var secondEvent = observation === "none" ? 1 : evidence(postAfterTestimony, obsGivenR, obsGivenNotR);
    var secondNumerator = observation === "none" ? postAfterTestimony : obsGivenR * postAfterTestimony;
    var postAfterSecond = observation === "none" ? postAfterTestimony : applyObservation(postAfterTestimony, obsGivenR, obsGivenNotR);

    var step1Evidence = 0;
    if (prior > EPS && postAfterTestimony > EPS) {
      step1Evidence = safeLog2(postAfterTestimony / prior);
    }
    var step2Evidence = 0;
    if (postAfterTestimony > EPS && postAfterSecond > EPS) {
      step2Evidence = safeLog2(postAfterSecond / postAfterTestimony);
    }

    return {
      prior: prior,
      tGivenR: tGivenR,
      tGivenNotR: tGivenNotR,
      pTestimony: testimonyEvent,
      numerator: testimonyNumerator,
      posterior: postAfterSecond,
      posteriorAfterTestimony: postAfterTestimony,
      posteriorAfterSecondSignal: postAfterSecond,
      secondSignalGivenR: sGivenR,
      secondSignalGivenNotR: sGivenNotR,
      observation: observation,
      secondSignalLikelihoodGivenR: obsGivenR,
      secondSignalLikelihoodGivenNotR: obsGivenNotR,
      pSecondSignalEvent: secondEvent,
      secondSignalNumerator: secondNumerator,
      stepEvidenceBits: {
        testimony: step1Evidence,
        secondSignal: step2Evidence
      },
      logEvidence: step1Evidence + step2Evidence,
      klUpdateCost: bernoulliKL(postAfterSecond, prior)
    };
  }

  function round(value, places) {
    var m = Math.pow(10, places);
    return Math.round(value * m) / m;
  }

  return {
    PRESETS: PRESETS,
    clamp01: clamp01,
    evidence: evidence,
    posterior: posterior,
    applyObservation: applyObservation,
    deriveState: deriveState,
    deriveSequentialState: deriveSequentialState,
    round: round
  };
});
