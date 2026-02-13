/**
 * Prior Slider Explorable
 * 
 * A small interactive widget that lets users explore how different
 * prior probabilities affect Bayesian updating.
 * 
 * Embed in article using:
 * <div class="explorable prior-slider-explorable" data-preset="canonical"></div>
 */

(function () {
  'use strict';

  function PriorSliderExplorable(container) {
    this.container = container;
    this.root = container;
    this.prior = 0.30;
    this.tGivenR = 0.85;
    this.tGivenNotR = 0.10;
    this.init();
  }

  PriorSliderExplorable.prototype.init = function () {
    this.render();
    this.bindEvents();
  };

  PriorSliderExplorable.prototype.render = function () {
    var self = this;
    
    this.root.innerHTML = 
      '<div class="prior-slider-widget">' +
        '<div class="prior-slider-header">' +
          '<h4>Prior Probability</h4>' +
          '<span class="prior-value">' + (this.prior * 100).toFixed(0) + '%</span>' +
        '</div>' +
        '<input type="range" class="prior-slider" min="0.01" max="0.99" step="0.01" value="' + this.prior + '" aria-label="Prior probability">' +
        '<div class="prior-slider-scale">' +
          '<span>0%</span>' +
          '<span>50%</span>' +
          '<span>100%</span>' +
        '</div>' +
        '<div class="prior-slider-result">' +
          '<p>With this prior, testimony shifts belief by <strong class="prior-shift">' + this.calculateShift().toFixed(1) + 'pp</strong></p>' +
        '</div>' +
      '</div>';
  };

  PriorSliderExplorable.prototype.calculateShift = function () {
    // Simple Bayes calculation
    var pRain = this.prior;
    var pNotRain = 1 - pRain;
    var pTruth = this.tGivenR;
    var pFalse = this.tGivenNotR;
    
    var pTestimony = pTruth * pRain + pFalse * pNotRain;
    var posterior = (pTruth * pRain) / pTestimony;
    
    return (posterior - pRain) * 100;
  };

  PriorSliderExplorable.prototype.bindEvents = function () {
    var self = this;
    var slider = this.root.querySelector('.prior-slider');
    
    slider.addEventListener('input', function (e) {
      self.prior = parseFloat(e.target.value);
      self.update();
    });
  };

  PriorSliderExplorable.prototype.update = function () {
    var valueDisplay = this.root.querySelector('.prior-value');
    var shiftDisplay = this.root.querySelector('.prior-shift');
    
    valueDisplay.textContent = (this.prior * 100).toFixed(0) + '%';
    shiftDisplay.textContent = this.calculateShift().toFixed(1) + 'pp';
  };

  // Auto-initialize on DOM ready
  function init() {
    var containers = document.querySelectorAll('.prior-slider-explorable');
    containers.forEach(function (container) {
      // Skip if already initialized
      if (container.dataset.initialized) {
        return;
      }
      container.dataset.initialized = 'true';
      new PriorSliderExplorable(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual initialization
  window.PriorSliderExplorable = PriorSliderExplorable;

})();
