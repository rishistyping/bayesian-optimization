/**
 * Sharing Module
 * 
 * Provides social sharing and deep linking functionality.
 * - Twitter/LinkedIn share buttons
 * - URL state for sharing specific configurations
 * - Copy link functionality
 */

(function () {
  'use strict';

  var Sharing = {
    /**
     * Initialize sharing features
     */
    init: function () {
      this.createShareButtons();
      this.setupCopyLink();
      this.handleHashState();
    },

    /**
     * Create share buttons in the header
     */
    createShareButtons: function () {
      var headerTools = document.querySelector('.chapter-header-tools');
      if (!headerTools) {
        return;
      }

      // Check if share buttons already exist
      if (document.querySelector('.share-buttons')) {
        return;
      }

      var shareContainer = document.createElement('div');
      shareContainer.className = 'share-buttons';
      shareContainer.setAttribute('role', 'group');
      shareContainer.setAttribute('aria-label', 'Share this article');

      var shareHtml = 
        '<button type="button" class="share-btn share-twitter" aria-label="Share on Twitter" title="Share on Twitter">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>' +
          '</svg>' +
        '</button>' +
        '<button type="button" class="share-btn share-linkedin" aria-label="Share on LinkedIn" title="Share on LinkedIn">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>' +
          '</svg>' +
        '</button>' +
        '<button type="button" class="share-btn share-copy" aria-label="Copy link" title="Copy link">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
          '</svg>' +
        '</button>';

      shareContainer.innerHTML = shareHtml;
      headerTools.appendChild(shareContainer);

      // Bind events
      var twitterBtn = shareContainer.querySelector('.share-twitter');
      var linkedinBtn = shareContainer.querySelector('.share-linkedin');
      var copyBtn = shareContainer.querySelector('.share-copy');

      twitterBtn.addEventListener('click', this.shareOnTwitter.bind(this));
      linkedinBtn.addEventListener('click', this.shareOnLinkedIn.bind(this));
      copyBtn.addEventListener('click', this.copyLink.bind(this));
    },

    /**
     * Share on Twitter
     */
    shareOnTwitter: function () {
      var url = encodeURIComponent(window.location.href);
      var text = encodeURIComponent(document.title);
      window.open(
        'https://twitter.com/intent/tweet?url=' + url + '&text=' + text,
        'twitter-share',
        'width=550,height=420'
      );
    },

    /**
     * Share on LinkedIn
     */
    shareOnLinkedIn: function () {
      var url = encodeURIComponent(window.location.href);
      window.open(
        'https://www.linkedin.com/sharing/share-offsite/?url=' + url,
        'linkedin-share',
        'width=550,height=420'
      );
    },

    /**
     * Copy link to clipboard
     */
    copyLink: function () {
      var url = window.location.href;
      
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          this.showCopyFeedback();
        }.bind(this));
      } else {
        // Fallback for older browsers
        var textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.showCopyFeedback();
      }
    },

    /**
     * Show copy feedback
     */
    showCopyFeedback: function () {
      var copyBtn = document.querySelector('.share-copy');
      if (!copyBtn) {
        return;
      }

      var originalTitle = copyBtn.getAttribute('title');
      copyBtn.setAttribute('title', 'Copied!');
      copyBtn.classList.add('copied');

      setTimeout(function () {
        copyBtn.setAttribute('title', originalTitle || 'Copy link');
        copyBtn.classList.remove('copied');
      }, 2000);
    },

    /**
     * Set up copy link for section anchors
     */
    setupCopyLink: function () {
      var headings = document.querySelectorAll('d-article h2, d-article h3');
      headings.forEach(function (heading) {
        if (!heading.id) {
          return;
        }

        heading.addEventListener('mouseenter', function () {
          if (this.querySelector('.section-link')) {
            return;
          }
          var link = document.createElement('a');
          link.className = 'section-link';
          link.href = '#' + heading.id;
          link.setAttribute('aria-label', 'Link to section');
          link.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';
          heading.insertBefore(link, heading.firstChild);
        }.bind(this));

        heading.addEventListener('mouseleave', function () {
          var link = this.querySelector('.section-link');
          if (link) {
            link.remove();
          }
        });
      });
    },

    /**
     * Handle URL hash state for deep linking
     */
    handleHashState: function () {
      var hash = window.location.hash;
      if (hash) {
        // Smooth scroll to section
        setTimeout(function () {
          var target = document.querySelector(hash);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      }
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      Sharing.init();
    });
  } else {
    Sharing.init();
  }

  // Expose for manual use
  window.Sharing = Sharing;

})();
