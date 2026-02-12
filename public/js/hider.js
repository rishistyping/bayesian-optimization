(function () {
  var THEME_STORAGE_KEY = "tla-theme";

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  function readStoredTheme() {
    try {
      var value = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (value === "light" || value === "dark") {
        return value;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function writeStoredTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      // noop
    }
  }

  function detectPreferredTheme() {
    var stored = readStoredTheme();
    if (stored) {
      return stored;
    }
    // Default is always light unless user explicitly chose dark.
    return "light";
  }

  function applyTheme(theme) {
    var safeTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", safeTheme);
    return safeTheme;
  }

  function updateThemeToggleButton(button, theme) {
    if (!button) {
      return;
    }
    var isDark = theme === "dark";
    button.setAttribute("aria-pressed", isDark ? "true" : "false");
    button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    button.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
  }

  function ensureContentId(content, index) {
    if (!content.id) {
      content.id = "collapsible-content-" + index;
    }
    return content.id;
  }

  function setExpanded(button, content, expanded) {
    button.classList.toggle("active", expanded);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    content.setAttribute("aria-hidden", expanded ? "false" : "true");
    content.hidden = !expanded;

    if (expanded) {
      content.hidden = false;
      content.style.maxHeight = content.scrollHeight + "px";
      content.style.paddingTop = "0.6rem";
      content.style.paddingBottom = "0.8rem";
    } else {
      content.style.maxHeight = null;
      content.style.paddingTop = "0";
      content.style.paddingBottom = "0";
    }
  }

  function focusFirstInteractive(content) {
    var focusable = content.querySelector(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );

    if (focusable && !focusable.disabled) {
      focusable.focus();
    }
  }

  function onToggle(event, options) {
    var opts = options || {};
    var button = event.currentTarget;
    var content = button.nextElementSibling;
    if (!content) {
      return;
    }
    var expanded = button.getAttribute("aria-expanded") === "true";
    var nextExpanded = !expanded;
    setExpanded(button, content, nextExpanded);

    if (nextExpanded && opts.moveFocus) {
      focusFirstInteractive(content);
    }
  }

  function onToggleKeydown(event) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle(
        { currentTarget: event.currentTarget },
        { moveFocus: !!event.altKey }
      );
    }
  }

  function initCollapsibles() {
    var toggles = toArray(document.getElementsByClassName("collapsible"));

    toggles.forEach(function (toggle, index) {
      var content = toggle.nextElementSibling;
      if (!content) {
        return;
      }

      toggle.setAttribute("type", "button");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", ensureContentId(content, index));

      toggle.removeEventListener("click", onToggle);
      toggle.removeEventListener("keydown", onToggleKeydown);
      toggle.addEventListener("click", onToggle);
      toggle.addEventListener("keydown", onToggleKeydown);

      setExpanded(toggle, content, false);
    });
  }

  function updateContentsProgress(progressFill, activeIndex, totalLinks) {
    if (!progressFill) {
      return;
    }
    var denominator = Math.max(1, totalLinks - 1);
    var safeIndex = activeIndex >= 0 ? activeIndex : 0;
    var progress = Math.max(0, Math.min(1, safeIndex / denominator));
    progressFill.style.transformOrigin = "0 50%";
    progressFill.style.transform = "scaleX(" + progress + ")";
  }

  function setActiveContentsLink(links, activeId, progressFill) {
    var activeIndex = -1;

    links.forEach(function (link, index) {
      var href = link.getAttribute("href") || "";
      var targetId = href.charAt(0) === "#" ? href.slice(1) : "";
      var isActive = targetId && targetId === activeId;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        activeIndex = index;
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    if (activeIndex < 0 && links.length > 0) {
      links[0].classList.add("is-active");
      links[0].setAttribute("aria-current", "true");
      activeIndex = 0;
    }

    updateContentsProgress(progressFill, activeIndex, links.length);
  }

  function initChapterContents() {
    var nav = document.querySelector(".chapter-contents");
    if (!nav) {
      return;
    }

    var links = toArray(nav.querySelectorAll("a[data-contents-link]"));
    if (!links.length) {
      return;
    }
    var progressFill = document.getElementById("chapter-contents-progress-fill");

    var sections = links
      .map(function (link) {
        var href = link.getAttribute("href") || "";
        if (!href || href.charAt(0) !== "#") {
          return null;
        }
        return document.getElementById(href.slice(1));
      })
      .filter(Boolean);

    if (!sections.length) {
      setActiveContentsLink(links, null, progressFill);
      return;
    }

    function pickActiveSectionId() {
      var focusLine = window.innerHeight * 0.28;
      var bestSection = null;
      var bestDistance = Infinity;

      sections.forEach(function (section) {
        var rect = section.getBoundingClientRect();
        var inView = rect.bottom > 0 && rect.top < window.innerHeight * 0.75;
        if (!inView) {
          return;
        }
        var distance = Math.abs(rect.top - focusLine);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSection = section;
        }
      });

      if (bestSection) {
        return bestSection.id;
      }
      return sections[0].id;
    }

    function updateActiveContents() {
      setActiveContentsLink(links, pickActiveSectionId(), progressFill);
    }

    var hash = window.location.hash;
    if (hash && hash.length > 1) {
      setActiveContentsLink(links, hash.slice(1), progressFill);
    } else {
      setActiveContentsLink(links, sections[0].id, progressFill);
    }

    if (!("IntersectionObserver" in window)) {
      return;
    }

    var observer = new IntersectionObserver(
      function () {
        updateActiveContents();
      },
      {
        rootMargin: "-22% 0px -55% 0px",
        threshold: [0, 0.2, 0.5, 1]
      }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });

    links.forEach(function (link) {
      link.addEventListener("click", function () {
        var href = link.getAttribute("href") || "";
        if (href.charAt(0) === "#") {
          setActiveContentsLink(links, href.slice(1), progressFill);
        }
      });
    });
  }

  function initThemeToggle() {
    var toggleButton = document.getElementById("theme-toggle");
    var appliedTheme = applyTheme(detectPreferredTheme());
    updateThemeToggleButton(toggleButton, appliedTheme);

    if (toggleButton) {
      toggleButton.addEventListener("click", function () {
        var current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        var next = current === "dark" ? "light" : "dark";
        applyTheme(next);
        writeStoredTheme(next);
        updateThemeToggleButton(toggleButton, next);
      });
    }

    if (window.matchMedia) {
      var schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      var handleSystemThemeChange = function (event) {
        if (readStoredTheme()) {
          return;
        }
        var next = event.matches ? "dark" : "light";
        applyTheme(next);
        updateThemeToggleButton(toggleButton, next);
      };
      if (typeof schemeQuery.addEventListener === "function") {
        schemeQuery.addEventListener("change", handleSystemThemeChange);
      } else if (typeof schemeQuery.addListener === "function") {
        schemeQuery.addListener(handleSystemThemeChange);
      }
    }
  }

  function initScrollProgress() {
    var progressEl = document.getElementById("page-scroll-progress");
    if (!progressEl) {
      return;
    }

    var doc = document.documentElement;
    var ticking = false;

    function updateProgress() {
      var maxScrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
      var current = Math.max(0, window.scrollY || doc.scrollTop || 0);
      var progress = Math.min(1, current / maxScrollable);
      progressEl.style.transform = "scaleX(" + progress + ")";
      ticking = false;
    }

    function scheduleUpdate() {
      if (ticking) {
        return;
      }
      ticking = true;
      window.requestAnimationFrame(updateProgress);
    }

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("load", scheduleUpdate);
    scheduleUpdate();
  }

  function initPageEnhancements() {
    initThemeToggle();
    initScrollProgress();
    initCollapsibles();
    initChapterContents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPageEnhancements);
  } else {
    initPageEnhancements();
  }
})();
