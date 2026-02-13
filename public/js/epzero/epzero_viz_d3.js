(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EpZeroVizD3 = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  function makeNoop() {
    return {
      update: function () {},
      setReducedMotion: function () {},
      destroy: function () {}
    };
  }

  function init(rootEl, options) {
    if (!rootEl) {
      return makeNoop();
    }

    var opts = options || {};
    var d3Ref = typeof window !== "undefined" && window.d3 && typeof window.d3.select === "function" ? window.d3 : null;
    if (!d3Ref) {
      return makeNoop();
    }

    var reducedMotion = !!opts.reducedMotion;
    var resizeObserver = null;
    var lastPayload = null;

    var svg = d3Ref
      .select(rootEl)
      .append("svg")
      .attr("class", "epzero-svg")
      .attr("preserveAspectRatio", "xMidYMin meet");

    var gCells = svg.append("g").attr("class", "epzero-cells");

    function layout(payload) {
      var width = Math.max(320, rootEl.clientWidth || 320);
      var maxNumber = Math.max(1, Number(payload.maxNumber) || 100);
      var cols = Math.max(10, Math.ceil(Math.sqrt(maxNumber)));
      var innerWidth = width - 24;
      var cell = Math.max(18, Math.min(36, Math.floor(innerWidth / cols)));
      var rows = Math.ceil(maxNumber / cols);
      var height = rows * cell + 24;

      svg.attr("viewBox", "0 0 " + width + " " + height).attr("width", width).attr("height", height);

      return {
        width: width,
        height: height,
        cell: cell,
        cols: cols,
        offsetX: 12,
        offsetY: 12
      };
    }

    function render(payload) {
      lastPayload = payload;
      var dims = layout(payload);
      var maxNumber = Math.max(1, Number(payload.maxNumber) || 100);
      var activeLookup = new Set((payload.active || []).map(function (n) { return Number(n); }));
      var values = [];
      for (var n = 1; n <= maxNumber; n += 1) {
        values.push({
          n: n,
          active: activeLookup.has(n)
        });
      }

      var selection = gCells.selectAll("g.epzero-cell").data(values, function (d) { return d.n; });
      selection.exit().remove();

      var enter = selection.enter().append("g").attr("class", "epzero-cell");
      enter
        .append("rect")
        .attr("rx", 4)
        .attr("ry", 4)
        .attr("class", "epzero-cell-rect");
      enter
        .append("text")
        .attr("class", "epzero-cell-label")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central");

      var merged = enter.merge(selection);
      merged.attr("transform", function (d) {
        var index = d.n - 1;
        var col = index % dims.cols;
        var row = Math.floor(index / dims.cols);
        var x = dims.offsetX + col * dims.cell;
        var y = dims.offsetY + row * dims.cell;
        return "translate(" + x + "," + y + ")";
      });

      merged
        .select("rect")
        .attr("width", dims.cell - 3)
        .attr("height", dims.cell - 3)
        .attr("class", function (d) {
          return "epzero-cell-rect " + (d.active ? "is-active" : "is-eliminated");
        });

      merged
        .select("text")
        .attr("x", (dims.cell - 3) / 2)
        .attr("y", (dims.cell - 3) / 2)
        .text(function (d) { return d.n; })
        .attr("class", function (d) {
          return "epzero-cell-label " + (d.active ? "is-active" : "is-eliminated");
        });

      if (!reducedMotion) {
        merged
          .select("rect")
          .interrupt()
          .transition()
          .duration(170)
          .style("opacity", function (d) { return d.active ? 1 : 0.3; });
      } else {
        merged.select("rect").style("opacity", function (d) { return d.active ? 1 : 0.3; });
      }
    }

    function onResize() {
      if (lastPayload) {
        render(lastPayload);
      }
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(rootEl);
    } else {
      window.addEventListener("resize", onResize);
    }

    return {
      update: function (payload) {
        render(payload || { maxNumber: 100, active: [] });
      },
      setReducedMotion: function (nextReduced) {
        reducedMotion = !!nextReduced;
      },
      destroy: function () {
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        } else {
          window.removeEventListener("resize", onResize);
        }
        svg.remove();
      }
    };
  }

  return {
    init: init
  };
});
