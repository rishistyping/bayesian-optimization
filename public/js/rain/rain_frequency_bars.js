(function () {
  'use strict';

  var DEFAULTS = {
    populationSize: 1000
  };

  function clamp01(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString();
  }

  function createFrequencyBars(container) {
    var data = null;
    var reducedMotion = false;

    function calculateTree(population, prior, hitRate, falseAlarmRate) {
      // =============================================================================
      // What do the numbers mean?
      // =============================================================================
      // This function converts abstract probabilities into concrete numbers of people/events.
      // Instead of saying "30% chance of rain", we imagine 1000 similar days and count what happens.
      //
      // Starting with 1000 days:
      //   - rains: How many days actually have rain? (30% of 1000 = 300 days)
      //   - notRains: How many days are dry? (70% of 1000 = 700 days)
      //
      // Then for the 300 RAINY days, what does our friend say?
      //   - truePositives: Friend correctly says "rain" = 300 × 85% = 255 days
      //   - falseNegatives: Friend incorrectly says "no rain" = 300 - 255 = 45 days
      //
      // Then for the 700 DRY days, what does our friend say?
      //   - falsePositives: Friend incorrectly says "rain" = 700 × 10% = 70 days
      //   - trueNegatives: Friend correctly says "no rain" = 700 - 70 = 630 days
      //
      // This makes Bayes' theorem intuitive: When friend says "rain", which group are they from?
      // They're either from the 255 truthful reports OR the 70 false alarms.
      // So P(Rain | "Rain") = 255 / (255 + 70) = 78.5%

      var rains = Math.round(population * prior);
      var notRains = population - rains;

      var truePositives = Math.round(rains * hitRate);
      var falseNegatives = rains - truePositives;

      var falsePositives = Math.round(notRains * falseAlarmRate);
      var trueNegatives = notRains - falsePositives;

      return {
        total: population,
        rains: rains,
        notRains: notRains,
        truePositives: truePositives,
        falseNegatives: falseNegatives,
        falsePositives: falsePositives,
        trueNegatives: trueNegatives
      };
    }

    function render() {
      if (!data || !container) return;

      container.innerHTML = '';

      // Create wrapper
      var wrapper = document.createElement('div');
      wrapper.className = 'freq-bars-wrapper';

      // Title
      var title = document.createElement('div');
      title.className = 'freq-bars-title';
      title.textContent = 'Population: ' + formatNumber(data.total);
      wrapper.appendChild(title);

      // Row 1: It Rains vs No Rain
      wrapper.appendChild(createBarRow(
        'It Rains',
        data.rains,
        data.total,
        'var(--rain-prior)',
        formatNumber(data.rains),
        formatNumber(data.total) + ' × ' + (data.rains / data.total).toFixed(2)
      ));

      wrapper.appendChild(createBarRow(
        'No Rain',
        data.notRains,
        data.total,
        'var(--rain-muted)',
        formatNumber(data.notRains),
        formatNumber(data.total) + ' × ' + (data.notRains / data.total).toFixed(2)
      ));

      // Branch: It Rains
      var rainsBranch = document.createElement('div');
      rainsBranch.className = 'freq-branch';
      
      var branchLabel = document.createElement('div');
      branchLabel.className = 'freq-branch-label';
      branchLabel.textContent = '→ When it rains:';
      rainsBranch.appendChild(branchLabel);

      rainsBranch.appendChild(createBarRow(
        'Says "Rain"',
        data.truePositives,
        data.rains,
        '#1b8c4a',
        formatNumber(data.truePositives),
        formatNumber(data.rains) + ' × ' + (data.truePositives / data.rains).toFixed(2) + ' = True Positive'
      ));

      rainsBranch.appendChild(createBarRow(
        'Says "No Rain"',
        data.falseNegatives,
        data.rains,
        '#c4971b',
        formatNumber(data.falseNegatives),
        formatNumber(data.rains) + ' × ' + (data.falseNegatives / data.rains).toFixed(2) + ' = False Negative'
      ));

      wrapper.appendChild(rainsBranch);

      // Branch: No Rain
      var noRainBranch = document.createElement('div');
      noRainBranch.className = 'freq-branch';
      
      var branchLabel2 = document.createElement('div');
      branchLabel2.className = 'freq-branch-label';
      branchLabel2.textContent = '→ When no rain:';
      noRainBranch.appendChild(branchLabel2);

      noRainBranch.appendChild(createBarRow(
        'Says "Rain"',
        data.falsePositives,
        data.notRains,
        '#c44b1b',
        formatNumber(data.falsePositives),
        formatNumber(data.notRains) + ' × ' + (data.falsePositives / data.notRains).toFixed(2) + ' = False Positive'
      ));

      noRainBranch.appendChild(createBarRow(
        'Says "No Rain"',
        data.trueNegatives,
        data.notRains,
        '#1b6c8c',
        formatNumber(data.trueNegatives),
        formatNumber(data.notRains) + ' × ' + (data.trueNegatives / data.notRains).toFixed(2) + ' = True Negative'
      ));

      wrapper.appendChild(noRainBranch);

      // Posterior calculation box
      // =============================================================================
      // What do the numbers mean?
      // =============================================================================
      // This is the key insight: After your friend says "it's raining",
      // we're looking at ONLY the times when friend said "rain" (not all 1000 days).
      //
      // Out of the 255 + 70 = 325 times friend said "rain":
      //   - 255 were TRUE (it was actually raining)
      //   - 70 were FALSE ALARMS (it wasn't raining)
      //
      // So the answer is: 255 / 325 = 78.5%
      //
      // This is the natural-frequency version of Bayes' theorem:
      // "Out of all the times someone says 'rain', what fraction was correct?"
      //
      // It's much more intuitive than: P(R|T) = P(T|R) × P(R) / P(T)

      var posterior = data.truePositives + data.falsePositives > 0 
        ? data.truePositives / (data.truePositives + data.falsePositives) 
        : 0;
      
      var posteriorBox = document.createElement('div');
      posteriorBox.className = 'freq-posterior-box';
      
      var posteriorLabel = document.createElement('div');
      posteriorLabel.className = 'freq-posterior-label';
      posteriorLabel.textContent = 'After hearing "It\'s raining":';
      posteriorBox.appendChild(posteriorLabel);
      
      var posteriorValue = document.createElement('div');
      posteriorValue.className = 'freq-posterior-value';
      posteriorValue.textContent = (posterior * 100).toFixed(1) + '%';
      posteriorBox.appendChild(posteriorValue);
      
      var posteriorCalc = document.createElement('div');
      posteriorCalc.className = 'freq-posterior-calc';
      posteriorCalc.textContent = formatNumber(data.truePositives) + ' / (' + formatNumber(data.truePositives) + ' + ' + formatNumber(data.falsePositives) + ')';
      posteriorBox.appendChild(posteriorCalc);

      wrapper.appendChild(posteriorBox);

      container.appendChild(wrapper);
    }

    function createBarRow(label, count, total, color, displayCount, tooltip) {
      var row = document.createElement('div');
      row.className = 'freq-bar-row';
      row.title = tooltip || '';

      var labelEl = document.createElement('div');
      labelEl.className = 'freq-bar-label';
      labelEl.textContent = label;
      row.appendChild(labelEl);

      var barContainer = document.createElement('div');
      barContainer.className = 'freq-bar-container';
      
      var bar = document.createElement('div');
      bar.className = 'freq-bar-fill';
      bar.style.width = (count / total * 100) + '%';
      bar.style.backgroundColor = color;
      
      barContainer.appendChild(bar);
      row.appendChild(barContainer);

      var countEl = document.createElement('div');
      countEl.className = 'freq-bar-count';
      countEl.textContent = displayCount;
      row.appendChild(countEl);

      return row;
    }

    // =============================================================================
    // INIT - Initialize the frequency bars visualization
    // =============================================================================
    // Parameters (opts):
    //   opts.prior: P(R) = Prior = Starting belief (default: 0.30 = 30%)
    //   opts.hitRate: P(T|R) = Sensitivity = True positive rate (default: 0.85 = 85%)
    //   opts.falseAlarmRate: P(T|¬R) = False Alarm = False positive rate (default: 0.15 = 15%)
    //   opts.reducedMotion: Boolean for accessibility (reduce animations)
    //
    // The visualization shows Bayesian updating using natural frequencies
    // =============================================================================
    function init(opts) {
      opts = opts || {};
      reducedMotion = opts.reducedMotion || false;
      console.log('[FrequencyBars] Initializing with:', opts);
      update(opts.prior || 0.3, opts.hitRate || 0.85, opts.falseAlarmRate || 0.15);
      return api;
    }

    // =============================================================================
    // UPDATE - Receives new probability values and re-renders the frequency bars
    // =============================================================================
    // Parameters:
    //   prior: P(R) = Your starting belief before testimony (e.g., 0.30 = 30%)
    //   hitRate: P(T|R) = Sensitivity = Friend says "rain" when it actually rains (e.g., 0.85)
    //   falseAlarmRate: P(T|¬R) = False Alarm = Friend says "rain" when it's NOT raining (e.g., 0.10)
    //
    // These get converted into natural frequencies (out of 1000) for intuitive understanding
    // =============================================================================
    function update(prior, hitRate, falseAlarmRate) {
      data = calculateTree(DEFAULTS.populationSize, clamp01(prior), clamp01(hitRate), clamp01(falseAlarmRate));
      console.log('[FrequencyBars] Data:', data);
      render();
    }

    function setReducedMotion(value) {
      reducedMotion = value;
    }

    function destroy() {
      if (container) {
        container.innerHTML = '';
      }
    }

    var api = {
      init: init,
      update: update,
      setReducedMotion: setReducedMotion,
      destroy: destroy
    };

    return api;
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createFrequencyBars;
  } else if (typeof window !== 'undefined') {
    window.createFrequencyBars = createFrequencyBars;
  }
})();
