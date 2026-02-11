(function () {
  var EPS = 1e-6;
  var SHAPE_EPS = 1e-3;

  var DEFAULTS = {
    concentrationPrior: 18,
    concentrationLikelihood: 18,
    concentrationPosterior: 24,
    sampleCount: 320,
    particleCount: 320,
    particleRadius: 1.8,
    particleDurationMs: 760,
    threshold: 0.6
  };

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

  function createNoopController() {
    return {
      update: function () {},
      playDrift: function () {},
      flashThreshold: function () {},
      setReducedMotion: function () {},
      destroy: function () {}
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp01(t);
  }

  function formatProb(value) {
    return clamp01(value).toFixed(2);
  }

  function formatInterval(low, high) {
    return "[" + formatProb(low) + ", " + formatProb(high) + "]";
  }

  function betaShape(mean, concentration) {
    var m = Math.min(1 - EPS, Math.max(EPS, clamp01(mean)));
    var c = Math.max(SHAPE_EPS, Number(concentration) || 1);
    return {
      alpha: Math.max(SHAPE_EPS, m * c),
      beta: Math.max(SHAPE_EPS, (1 - m) * c)
    };
  }

  function rawBetaDensity(x, alpha, beta) {
    var xx = Math.min(1 - EPS, Math.max(EPS, x));
    var logDensity = (alpha - 1) * Math.log(xx) + (beta - 1) * Math.log(1 - xx);
    var density = Math.exp(logDensity);
    if (!Number.isFinite(density) || density < 0) {
      return 0;
    }
    return density;
  }

  function buildCurve(mean, concentration, sampleCount) {
    var shape = betaShape(mean, concentration);
    var count = Math.max(16, Number(sampleCount) || 320);
    var xs = new Array(count);
    var pdf = new Array(count);
    var dx = 1 / (count - 1);
    var area = 0;
    var i;

    for (i = 0; i < count; i += 1) {
      var x = i * dx;
      var y = rawBetaDensity(x, shape.alpha, shape.beta);
      xs[i] = x;
      pdf[i] = y;
      if (i > 0) {
        area += (pdf[i - 1] + y) * 0.5 * dx;
      }
    }

    if (!(area > EPS)) {
      area = 1;
    }

    var cdf = new Array(count);
    var running = 0;
    var maxY = 0;

    for (i = 0; i < count; i += 1) {
      pdf[i] = pdf[i] / area;
      maxY = Math.max(maxY, pdf[i]);
      if (i > 0) {
        running += (pdf[i - 1] + pdf[i]) * 0.5 * dx;
      }
      cdf[i] = running;
    }

    cdf[count - 1] = 1;

    return {
      xs: xs,
      pdf: pdf,
      cdf: cdf,
      maxY: maxY
    };
  }

  function invertQuantile(xs, cdf, q) {
    var target = clamp01(q);
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

    if (lo <= 0) {
      return xs[0];
    }

    var i0 = lo - 1;
    var i1 = lo;
    var c0 = cdf[i0];
    var c1 = cdf[i1];
    var t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    return xs[i0] + (xs[i1] - xs[i0]) * t;
  }

  function computeEti(xs, cdf) {
    return {
      low: invertQuantile(xs, cdf, 0.025),
      high: invertQuantile(xs, cdf, 0.975)
    };
  }

  function computeHdi(xs, cdf, mass) {
    var targetMass = clamp01(mass);
    var bestLow = 0;
    var bestHigh = xs.length - 1;
    var bestWidth = 1;
    var i = 0;
    var j = 0;

    while (i < xs.length && j < xs.length) {
      var leftMass = i > 0 ? cdf[i - 1] : 0;
      var currentMass = cdf[j] - leftMass;

      if (currentMass >= targetMass) {
        var width = xs[j] - xs[i];
        if (width < bestWidth) {
          bestWidth = width;
          bestLow = i;
          bestHigh = j;
        }
        i += 1;
      } else {
        j += 1;
      }
    }

    return {
      low: xs[bestLow],
      high: xs[bestHigh]
    };
  }

  function buildCdfFromCurve(curve) {
    var cdf = new Array(curve.pdf.length);
    var running = 0;
    var dx = 1 / (curve.pdf.length - 1);

    for (var i = 0; i < curve.pdf.length; i += 1) {
      if (i > 0) {
        running += (curve.pdf[i - 1] + curve.pdf[i]) * 0.5 * dx;
      }
      cdf[i] = running;
    }
    cdf[cdf.length - 1] = 1;
    return cdf;
  }

  function sampleFromCdf(cdf, u) {
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

    if (lo <= 0) {
      return 0;
    }

    var lowIx = lo - 1;
    var c0 = cdf[lowIx];
    var c1 = cdf[lo];
    var t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    return clamp01((lowIx + t) / (cdf.length - 1));
  }

  function init(mountEl, options) {
    if (!mountEl) {
      return createNoopController();
    }

    var d3Ref = window.d3 && typeof window.d3.select === "function" ? window.d3 : null;
    if (!d3Ref) {
      return createNoopController();
    }

    var opts = Object.assign({}, DEFAULTS, options || {});
    var reducedMotion = !!opts.reducedMotion;
    var destroyed = false;

    var gaugesMount = opts.gaugesMount || null;

    var width = 640;
    var height = 360;
    var margin = { top: 52, right: 18, bottom: 90, left: 34 };

    var particlePool = [];
    var thresholdPulseTimer = null;

    var rootSel = d3Ref.select(mountEl);
    rootSel.selectAll("*").remove();

    var svg = rootSel.append("svg")
      .attr("class", "bayes-plot-svg")
      .attr("role", "img")
      .attr("aria-label", "Prior, likelihood, and posterior belief curves with uncertainty intervals");

    var gGrid = svg.append("g").attr("class", "bayes-grid");
    var gAxes = svg.append("g").attr("class", "bayes-axes");
    var gLegend = svg.append("g").attr("class", "bayes-legend");
    var gMarkers = svg.append("g").attr("class", "bayes-markers");
    var gCurves = svg.append("g").attr("class", "bayes-curves");
    var gParticles = svg.append("g").attr("class", "bayes-particles");
    var gShift = svg.append("g").attr("class", "bayes-shift");
    var gIntervals = svg.append("g").attr("class", "bayes-intervals");

    var curvePriorPath = gCurves.append("path").attr("class", "bayes-curve bayes-curve-prior");
    var curveLikePath = gCurves.append("path").attr("class", "bayes-curve bayes-curve-likelihood");
    var curvePostPath = gCurves.append("path").attr("class", "bayes-curve bayes-curve-posterior");

    var priorMarker = gMarkers.append("line").attr("class", "bayes-marker bayes-marker-prior");
    var postMarker = gMarkers.append("line").attr("class", "bayes-marker bayes-marker-posterior");
    var midMarker = gMarkers.append("line").attr("class", "bayes-marker bayes-marker-mid");
    var thresholdMarker = gMarkers.append("line").attr("class", "bayes-marker bayes-marker-threshold");

    var shiftText = gShift.append("text").attr("class", "bayes-shift-label");

    var etiLine = gIntervals.append("line").attr("class", "bayes-interval-line bayes-interval-eti");
    var etiLabel = gIntervals.append("text").attr("class", "bayes-interval-label").text("95% ETI");
    var etiValue = gIntervals.append("text").attr("class", "bayes-interval-value");

    var hdiLine = gIntervals.append("line").attr("class", "bayes-interval-line bayes-interval-hdi");
    var hdiLabel = gIntervals.append("text").attr("class", "bayes-interval-label").text("95% HDI");
    var hdiValue = gIntervals.append("text").attr("class", "bayes-interval-value");

    var xScale = d3Ref.scaleLinear().domain([0, 1]);
    var yScale = d3Ref.scaleLinear().domain([0, 1]);

    var lastModel = null;

    var gaugeState = null;

    function createGaugeDom() {
      if (!gaugesMount) {
        return null;
      }

      var gaugesRoot = d3Ref.select(gaugesMount);
      gaugesRoot.selectAll("*").remove();

      var defs = [
        { key: "supportRain", label: "Support Rain" },
        { key: "supportNotRain", label: "Support Not Rain" },
        { key: "evidence", label: "Evidence strength" }
      ];

      var wrappers = gaugesRoot.selectAll(".bayes-gauge")
        .data(defs)
        .enter()
        .append("div")
        .attr("class", "bayes-gauge")
        .attr("data-gauge", function (d) { return d.key; });

      wrappers.append("p")
        .attr("class", "bayes-gauge-label")
        .text(function (d) { return d.label; });

      var svgGauge = wrappers.append("svg")
        .attr("class", "bayes-gauge-svg")
        .attr("viewBox", "0 0 120 120")
        .attr("aria-hidden", "true");

      svgGauge.append("circle")
        .attr("class", "bayes-gauge-track")
        .attr("cx", 60)
        .attr("cy", 60)
        .attr("r", 44);

      svgGauge.append("circle")
        .attr("class", "bayes-gauge-fill")
        .attr("cx", 60)
        .attr("cy", 60)
        .attr("r", 44)
        .attr("transform", "rotate(-90 60 60)");

      svgGauge.append("text")
        .attr("class", "bayes-gauge-value")
        .attr("x", 60)
        .attr("y", 66)
        .attr("text-anchor", "middle")
        .text("0.00");

      return {
        root: gaugesRoot,
        defs: defs
      };
    }

    gaugeState = createGaugeDom();

    function updateGauge(key, fraction, valueText) {
      if (!gaugeState) {
        return;
      }

      var wrap = gaugeState.root.select(".bayes-gauge[data-gauge='" + key + "']");
      if (wrap.empty()) {
        return;
      }

      var fill = wrap.select("circle.bayes-gauge-fill");
      var r = Number(fill.attr("r")) || 44;
      var circumference = 2 * Math.PI * r;
      var f = clamp01(fraction);
      var dash = circumference * f;
      var gap = circumference - dash;

      fill
        .attr("stroke-dasharray", dash.toFixed(3) + " " + gap.toFixed(3))
        .attr("stroke-dashoffset", "0");

      wrap.select("text.bayes-gauge-value").text(valueText);
    }

    function ensureSize() {
      var rect = mountEl.getBoundingClientRect();
      if (rect.width > 0) {
        width = rect.width;
      }

      var targetHeight = Math.max(320, Math.min(420, width * 0.58));
      height = targetHeight;

      svg
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", "0 0 " + width.toFixed(2) + " " + height.toFixed(2));

      xScale.range([margin.left, width - margin.right]);
      yScale.range([height - margin.bottom, margin.top]);
    }

    function curveToData(curve) {
      var rows = new Array(curve.xs.length);
      for (var i = 0; i < curve.xs.length; i += 1) {
        rows[i] = [curve.xs[i], curve.pdf[i]];
      }
      return rows;
    }

    function initializeParticles(mean) {
      var c = buildCurve(mean, opts.concentrationPrior, opts.sampleCount);
      var cdf = buildCdfFromCurve(c);
      particlePool = new Array(opts.particleCount);
      for (var i = 0; i < opts.particleCount; i += 1) {
        var p = sampleFromCdf(cdf, Math.random());
        particlePool[i] = {
          id: i,
          p: p,
          target: p,
          yJitter: Math.random()
        };
      }
    }

    function drawParticles() {
      var yTop = margin.top + 8;
      var yBottom = yScale(0) - 8;

      var selection = gParticles.selectAll("circle.bayes-particle")
        .data(particlePool, function (d) { return d.id; });

      selection.exit().remove();

      selection.enter()
        .append("circle")
        .attr("class", "bayes-particle")
        .attr("r", opts.particleRadius)
        .merge(selection)
        .attr("cx", function (d) { return xScale(d.p); })
        .attr("cy", function (d) { return lerp(yTop, yBottom, d.yJitter); });
    }

    function playDriftToPosterior(priorMean, posteriorMean, animate, durationMs) {
      if (!particlePool.length) {
        initializeParticles(priorMean);
      }

      var c = buildCurve(posteriorMean, opts.concentrationPosterior, opts.sampleCount);
      var cdf = buildCdfFromCurve(c);

      for (var i = 0; i < particlePool.length; i += 1) {
        particlePool[i].target = sampleFromCdf(cdf, Math.random());
        particlePool[i].yJitter = Math.random();
      }

      var yTop = margin.top + 8;
      var yBottom = yScale(0) - 8;
      var circles = gParticles.selectAll("circle.bayes-particle");

      if (!animate || reducedMotion) {
        circles
          .attr("cx", function (d) {
            d.p = d.target;
            return xScale(d.p);
          })
          .attr("cy", function (d) { return lerp(yTop, yBottom, d.yJitter); });
        return;
      }

      var dur = Math.max(120, Number(durationMs) || opts.particleDurationMs);
      circles.interrupt();
      circles
        .transition()
        .duration(dur)
        .ease(d3Ref.easeCubicInOut)
        .attr("cx", function (d) { return xScale(d.target); })
        .attr("cy", function (d) { return lerp(yTop, yBottom, d.yJitter); })
        .on("end", function (event, d) {
          d.p = d.target;
        });
    }

    function resetParticlesToPrior(mean) {
      var c = buildCurve(mean, opts.concentrationPrior, opts.sampleCount);
      var cdf = buildCdfFromCurve(c);
      if (!particlePool.length) {
        initializeParticles(mean);
      }
      for (var i = 0; i < particlePool.length; i += 1) {
        particlePool[i].p = sampleFromCdf(cdf, Math.random());
        particlePool[i].target = particlePool[i].p;
        particlePool[i].yJitter = Math.random();
      }
      drawParticles();
    }

    function renderLegend() {
      var items = [
        { key: "prior", label: "prior" },
        { key: "posterior", label: "posterior" },
        { key: "likelihood", label: "likelihood" }
      ];

      var startX = margin.left + 6;
      var y = margin.top - 20;
      var spacing = 120;

      var groups = gLegend.selectAll("g.bayes-legend-item")
        .data(items, function (d) { return d.key; });

      var entered = groups.enter().append("g").attr("class", function (d) {
        return "bayes-legend-item bayes-legend-" + d.key;
      });

      entered.append("line").attr("class", "bayes-legend-line");
      entered.append("text").attr("class", "bayes-legend-text");

      entered.merge(groups)
        .attr("transform", function (d, i) {
          return "translate(" + (startX + i * spacing).toFixed(2) + "," + y.toFixed(2) + ")";
        })
        .each(function (d) {
          var group = d3Ref.select(this);
          group.select("line")
            .attr("x1", 0)
            .attr("x2", 18)
            .attr("y1", 0)
            .attr("y2", 0);
          group.select("text")
            .attr("x", 24)
            .attr("y", 4)
            .text(d.label);
        });

      groups.exit().remove();
    }

    function renderGridAndAxis() {
      var yTicks = yScale.ticks(5);
      var xTicks = [0, 0.25, 0.5, 0.75, 1];

      var yLines = gGrid.selectAll("line.bayes-grid-y").data(yTicks);
      yLines.enter().append("line").attr("class", "bayes-grid-y").merge(yLines)
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", function (d) { return yScale(d); })
        .attr("y2", function (d) { return yScale(d); });
      yLines.exit().remove();

      var xLines = gGrid.selectAll("line.bayes-grid-x").data(xTicks);
      xLines.enter().append("line").attr("class", "bayes-grid-x").merge(xLines)
        .attr("x1", function (d) { return xScale(d); })
        .attr("x2", function (d) { return xScale(d); })
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);
      xLines.exit().remove();

      var axisLabels = gAxes.selectAll("text.bayes-axis-x").data(xTicks);
      axisLabels.enter().append("text").attr("class", "bayes-axis-x").merge(axisLabels)
        .attr("x", function (d) { return xScale(d); })
        .attr("y", height - margin.bottom + 20)
        .attr("text-anchor", "middle")
        .text(function (d) { return d.toFixed(2); });
      axisLabels.exit().remove();

      var baseline = gAxes.selectAll("line.bayes-axis-baseline").data([0]);
      baseline.enter().append("line").attr("class", "bayes-axis-baseline").merge(baseline)
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", yScale(0))
        .attr("y2", yScale(0));
    }

    function renderCurves(model, renderOpts) {
      var priorCurve = buildCurve(model.prior, opts.concentrationPrior, opts.sampleCount);
      var posteriorCurve = buildCurve(model.posterior, opts.concentrationPosterior, opts.sampleCount);
      var denom = model.tGivenR + model.tGivenNotR;
      var pLike = denom > EPS ? model.tGivenR / denom : 0.5;
      var likeCurve = buildCurve(pLike, opts.concentrationLikelihood, opts.sampleCount);

      var yMax = Math.max(priorCurve.maxY, likeCurve.maxY, posteriorCurve.maxY, 0.001) * 1.08;
      yScale.domain([0, yMax]);

      renderGridAndAxis();
      renderLegend();

      var line = d3Ref.line()
        .curve(d3Ref.curveMonotoneX)
        .x(function (d) { return xScale(d[0]); })
        .y(function (d) { return yScale(d[1]); });

      curvePriorPath.attr("d", line(curveToData(priorCurve)));
      curveLikePath.attr("d", line(curveToData(likeCurve)));
      curvePostPath.attr("d", line(curveToData(posteriorCurve)));

      curvePriorPath.classed("is-ghosted", !!renderOpts.ghostPrior);
      curveLikePath.classed("is-highlight", !!renderOpts.highlightLikelihood);
      curvePostPath.classed("is-hidden", renderOpts.showPosterior === false);

      var topY = margin.top;
      var bottomY = yScale(0);

      priorMarker
        .attr("x1", xScale(model.prior))
        .attr("x2", xScale(model.prior))
        .attr("y1", topY)
        .attr("y2", bottomY)
        .classed("is-ghosted", !!renderOpts.ghostPrior);

      postMarker
        .attr("x1", xScale(model.posterior))
        .attr("x2", xScale(model.posterior))
        .attr("y1", topY)
        .attr("y2", bottomY)
        .classed("is-hidden", renderOpts.showPosterior === false);

      midMarker
        .attr("x1", xScale(0.5))
        .attr("x2", xScale(0.5))
        .attr("y1", topY)
        .attr("y2", bottomY);

      var threshold = clamp01(renderOpts.threshold);
      thresholdMarker
        .attr("x1", xScale(threshold))
        .attr("x2", xScale(threshold))
        .attr("y1", topY)
        .attr("y2", bottomY)
        .classed("is-muted", renderOpts.showPosterior === false);

      var cdf = posteriorCurve.cdf;
      var eti = computeEti(posteriorCurve.xs, cdf);
      var hdi = computeHdi(posteriorCurve.xs, cdf, 0.95);

      var intervalY1 = height - 44;
      var intervalY2 = height - 22;

      etiLine
        .attr("x1", xScale(eti.low))
        .attr("x2", xScale(eti.high))
        .attr("y1", intervalY1)
        .attr("y2", intervalY1)
        .classed("is-hidden", renderOpts.showPosterior === false);

      etiLabel
        .attr("x", margin.left)
        .attr("y", intervalY1 + 5);

      etiValue
        .attr("x", width - margin.right)
        .attr("y", intervalY1 + 5)
        .attr("text-anchor", "end")
        .text(renderOpts.showPosterior === false ? "hidden until update" : formatInterval(eti.low, eti.high));

      hdiLine
        .attr("x1", xScale(hdi.low))
        .attr("x2", xScale(hdi.high))
        .attr("y1", intervalY2)
        .attr("y2", intervalY2)
        .classed("is-hidden", renderOpts.showPosterior === false);

      hdiLabel
        .attr("x", margin.left)
        .attr("y", intervalY2 + 5);

      hdiValue
        .attr("x", width - margin.right)
        .attr("y", intervalY2 + 5)
        .attr("text-anchor", "end")
        .text(renderOpts.showPosterior === false ? "hidden until update" : formatInterval(hdi.low, hdi.high));

      var delta = model.posterior - model.prior;
      var moveText = (delta >= 0 ? "+" : "") + (delta * 100).toFixed(1) + " pts";
      shiftText
        .attr("x", xScale(0.5))
        .attr("y", margin.top - 34)
        .attr("text-anchor", "middle")
        .text("update shift: " + moveText)
        .classed("is-hidden", renderOpts.showPosterior === false);

      return {
        priorCurve: priorCurve,
        posteriorCurve: posteriorCurve
      };
    }

    function updateGauges(model, renderOpts) {
      if (!gaugeState) {
        return;
      }

      var posterior = clamp01(model.posterior);
      var oddsRain = posterior < 1 ? posterior / Math.max(EPS, 1 - posterior) : 999;
      var oddsNotRain = posterior > 0 ? (1 - posterior) / Math.max(EPS, posterior) : 999;
      var evidenceBits = Math.abs(Number(model.logEvidence) || 0);

      updateGauge("supportRain", posterior, renderOpts.showPosterior === false ? "--" : oddsRain.toFixed(2));
      updateGauge("supportNotRain", 1 - posterior, renderOpts.showPosterior === false ? "--" : oddsNotRain.toFixed(2));
      updateGauge("evidence", clamp01(evidenceBits / 2.5), renderOpts.showPosterior === false ? "--" : evidenceBits.toFixed(2));
    }

    function update(model, renderOptions) {
      if (destroyed) {
        return;
      }

      var renderOpts = Object.assign(
        {
          showPosterior: true,
          ghostPrior: false,
          highlightLikelihood: false,
          threshold: opts.threshold,
          resampleParticles: false,
          animateParticles: false,
          durationMs: opts.particleDurationMs,
          resetParticlesToPrior: false
        },
        renderOptions || {}
      );

      ensureSize();

      lastModel = {
        prior: clamp01(model.prior),
        posterior: clamp01(model.posterior),
        tGivenR: clamp01(model.tGivenR),
        tGivenNotR: clamp01(model.tGivenNotR),
        logEvidence: Number(model.logEvidence) || 0
      };

      renderCurves(lastModel, renderOpts);
      updateGauges(lastModel, renderOpts);

      if (!particlePool.length) {
        initializeParticles(lastModel.prior);
      }

      if (renderOpts.resetParticlesToPrior) {
        resetParticlesToPrior(lastModel.prior);
      } else {
        drawParticles();
      }

      if (renderOpts.resampleParticles) {
        playDriftToPosterior(
          lastModel.prior,
          lastModel.posterior,
          renderOpts.animateParticles,
          renderOpts.durationMs
        );
      }
    }

    function playDrift(options) {
      if (!lastModel) {
        return;
      }
      var o = options || {};
      playDriftToPosterior(
        clamp01(o.priorMean !== undefined ? o.priorMean : lastModel.prior),
        clamp01(o.posterior !== undefined ? o.posterior : lastModel.posterior),
        !!o.animate,
        o.durationMs
      );
    }

    function flashThreshold() {
      if (thresholdPulseTimer !== null) {
        clearTimeout(thresholdPulseTimer);
        thresholdPulseTimer = null;
      }
      thresholdMarker.classed("is-active", false);
      if (reducedMotion) {
        return;
      }
      thresholdMarker.classed("is-active", true);
      thresholdPulseTimer = setTimeout(function () {
        thresholdMarker.classed("is-active", false);
        thresholdPulseTimer = null;
      }, 640);
    }

    function setReducedMotion(nextValue) {
      reducedMotion = !!nextValue;
    }

    function handleResize() {
      if (!lastModel) {
        return;
      }
      update(lastModel, {});
    }

    var resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(mountEl);
    } else {
      window.addEventListener("resize", handleResize);
    }

    return {
      update: update,
      playDrift: playDrift,
      flashThreshold: flashThreshold,
      setReducedMotion: setReducedMotion,
      destroy: function () {
        if (destroyed) {
          return;
        }
        destroyed = true;
        if (thresholdPulseTimer !== null) {
          clearTimeout(thresholdPulseTimer);
          thresholdPulseTimer = null;
        }
        if (resizeObserver && typeof resizeObserver.disconnect === "function") {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener("resize", handleResize);
        }
        rootSel.selectAll("*").remove();
        if (gaugeState && gaugeState.root) {
          gaugeState.root.selectAll("*").remove();
        }
      }
    };
  }

  window.RainBayesPanelViz = {
    init: init
  };
})();
