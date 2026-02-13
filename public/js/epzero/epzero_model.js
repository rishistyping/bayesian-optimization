(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EpZeroModel = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  function clampInt(value, min, max) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) {
      return min;
    }
    if (n < min) {
      return min;
    }
    if (n > max) {
      return max;
    }
    return n;
  }

  function log2(n) {
    return Math.log(n) / Math.log(2);
  }

  var QUESTION_BANK = {
    gt50: {
      key: "gt50",
      label: "number > 50",
      test: function (n) { return n > 50; }
    },
    odd: {
      key: "odd",
      label: "number is odd",
      test: function (n) { return n % 2 !== 0; }
    },
    prime: {
      key: "prime",
      label: "number is prime",
      test: function (n) {
        if (n < 2) {
          return false;
        }
        for (var i = 2; i * i <= n; i += 1) {
          if (n % i === 0) {
            return false;
          }
        }
        return true;
      }
    },
    multiple3: {
      key: "multiple3",
      label: "number is a multiple of 3",
      test: function (n) { return n % 3 === 0; }
    },
    band_1_25: {
      key: "band_1_25",
      label: "number in [1, 25]",
      test: function (n) { return n >= 1 && n <= 25; }
    },
    band_26_50: {
      key: "band_26_50",
      label: "number in [26, 50]",
      test: function (n) { return n >= 26 && n <= 50; }
    },
    band_51_75: {
      key: "band_51_75",
      label: "number in [51, 75]",
      test: function (n) { return n >= 51 && n <= 75; }
    },
    band_76_100: {
      key: "band_76_100",
      label: "number in [76, 100]",
      test: function (n) { return n >= 76 && n <= 100; }
    }
  };

  function createUniverse(maxNumber) {
    var max = clampInt(maxNumber, 2, 1000);
    var values = new Array(max);
    for (var i = 1; i <= max; i += 1) {
      values[i - 1] = i;
    }
    return values;
  }

  function evaluateConstraint(number, constraint) {
    var q = QUESTION_BANK[constraint.questionKey];
    if (!q) {
      return true;
    }
    var result = !!q.test(number);
    return constraint.answer === "yes" ? result : !result;
  }

  function buildActiveSet(maxNumber, constraints) {
    var universe = createUniverse(maxNumber);
    return universe.filter(function (n) {
      for (var i = 0; i < constraints.length; i += 1) {
        if (!evaluateConstraint(n, constraints[i])) {
          return false;
        }
      }
      return true;
    });
  }

  function buildState(maxNumber, constraints) {
    var safeConstraints = (constraints || []).map(function (constraint) {
      return {
        questionKey: constraint.questionKey,
        answer: constraint.answer === "no" ? "no" : "yes"
      };
    });
    var max = clampInt(maxNumber, 2, 1000);
    return {
      maxNumber: max,
      constraints: safeConstraints,
      active: buildActiveSet(max, safeConstraints)
    };
  }

  function initialState(maxNumber) {
    return buildState(maxNumber || 100, []);
  }

  function applyConstraint(state, questionKey, answer) {
    var nextConstraints = state.constraints.slice();
    nextConstraints.push({
      questionKey: questionKey,
      answer: answer === "no" ? "no" : "yes"
    });
    return buildState(state.maxNumber, nextConstraints);
  }

  function removeLastConstraint(state) {
    if (!state.constraints.length) {
      return state;
    }
    var nextConstraints = state.constraints.slice(0, state.constraints.length - 1);
    return buildState(state.maxNumber, nextConstraints);
  }

  function metrics(state) {
    var total = state.maxNumber;
    var remaining = state.active.length;
    return {
      total: total,
      remaining: remaining,
      eliminated: Math.max(0, total - remaining),
      entropyBits: remaining > 0 ? log2(remaining) : 0
    };
  }

  function describeConstraint(constraint) {
    var q = QUESTION_BANK[constraint.questionKey];
    var base = q ? q.label : constraint.questionKey;
    return base + " = " + (constraint.answer === "no" ? "No" : "Yes");
  }

  return {
    QUESTION_BANK: QUESTION_BANK,
    createUniverse: createUniverse,
    initialState: initialState,
    applyConstraint: applyConstraint,
    removeLastConstraint: removeLastConstraint,
    metrics: metrics,
    describeConstraint: describeConstraint
  };
});
