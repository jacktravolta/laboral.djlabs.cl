    (function wireQuickReplies() {
      document.addEventListener('click', function (event) {
        var chip = event.target && event.target.closest
          ? event.target.closest('[data-question]')
          : null;
        if (!chip) return;
        event.preventDefault();
        var question = (chip.getAttribute('data-question') || '').trim();
        if (!question) return;
        window.location.href = 'app.html?q=' + encodeURIComponent(question);
      });
    })();
  