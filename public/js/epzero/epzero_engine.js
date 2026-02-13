(function () {
  function clampBits(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return n < 0 ? 0 : n;
  }

  function fixed(value, places) {
    return Number(value).toFixed(places);
  }

  function initEpZeroEngine(rootId) {
    var root = document.getElementById(rootId);
    if (!root || !window.EpZeroModel) {
      return;
    }

    var questionSelect = root.querySelector("#epzero-question");
    var answerSelect = root.querySelector("#epzero-answer");
    var applyBtn = root.querySelector("#epzero-apply");
    var undoBtn = root.querySelector("#epzero-undo");
    var resetBtn = root.querySelector("#epzero-reset");
    var remainingEl = root.querySelector("#epzero-remaining");
    var entropyEl = root.querySelector("#epzero-entropy");
    var listEl = root.querySelector("#epzero-constraint-list");
    var liveEl = root.querySelector("#epzero-live");
    var vizMount = root.querySelector("#epzero-viz");

    var reducedMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var prefersReducedMotion = !!(reducedMotionQuery && reducedMotionQuery.matches);

    var state = window.EpZeroModel.initialState(100);
    var viz = null;
    if (window.EpZeroVizD3 && typeof window.EpZeroVizD3.init === "function") {
      viz = window.EpZeroVizD3.init(vizMount, { reducedMotion: prefersReducedMotion });
    }

    function render() {
      var metrics = window.EpZeroModel.metrics(state);
      if (remainingEl) {
        remainingEl.textContent = String(metrics.remaining);
      }
      if (entropyEl) {
        entropyEl.textContent = fixed(clampBits(metrics.entropyBits), 3);
      }
      if (liveEl) {
        liveEl.textContent =
          "Remaining " +
          metrics.remaining +
          " of " +
          metrics.total +
          " candidates; uncertainty " +
          fixed(clampBits(metrics.entropyBits), 3) +
          " bits.";
      }

      if (listEl) {
        listEl.innerHTML = "";
        if (!state.constraints.length) {
          var empty = document.createElement("li");
          empty.textContent = "No constraints applied yet.";
          listEl.appendChild(empty);
        } else {
          state.constraints.forEach(function (constraint) {
            var li = document.createElement("li");
            li.textContent = window.EpZeroModel.describeConstraint(constraint);
            listEl.appendChild(li);
          });
        }
      }

      if (undoBtn) {
        undoBtn.disabled = state.constraints.length === 0;
      }

      if (viz && typeof viz.update === "function") {
        viz.update({ maxNumber: state.maxNumber, active: state.active });
      }
    }

    function applyConstraint() {
      if (!questionSelect || !answerSelect) {
        return;
      }
      var questionKey = questionSelect.value;
      var answer = answerSelect.value === "no" ? "no" : "yes";
      state = window.EpZeroModel.applyConstraint(state, questionKey, answer);
      render();
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", applyConstraint);
    }

    if (undoBtn) {
      undoBtn.addEventListener("click", function () {
        state = window.EpZeroModel.removeLastConstraint(state);
        render();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state = window.EpZeroModel.initialState(100);
        render();
      });
    }

    if (reducedMotionQuery) {
      var onReducedMotion = function (event) {
        prefersReducedMotion = !!event.matches;
        if (viz && typeof viz.setReducedMotion === "function") {
          viz.setReducedMotion(prefersReducedMotion);
        }
        render();
      };
      if (typeof reducedMotionQuery.addEventListener === "function") {
        reducedMotionQuery.addEventListener("change", onReducedMotion);
      } else if (typeof reducedMotionQuery.addListener === "function") {
        reducedMotionQuery.addListener(onReducedMotion);
      }
    }

    window.addEventListener("beforeunload", function () {
      if (viz && typeof viz.destroy === "function") {
        viz.destroy();
      }
      viz = null;
    });

    render();
  }

  window.initEpZeroEngine = initEpZeroEngine;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initEpZeroEngine("epzero-engine");
    });
  } else {
    initEpZeroEngine("epzero-engine");
  }
})();
