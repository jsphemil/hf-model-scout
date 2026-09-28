(function () {
  'use strict';

  var HFScout = window.HFScout;
  var API_BASE = 'https://huggingface.co/api/models';
  var FETCH_LIMIT = 100;
  var SEARCH_DEBOUNCE_MS = 400;
  var SHORTLIST_KEY = 'hf-model-scout:shortlist';
  var MAX_COMPARE = 3;

  var PIPELINE_TASKS = [
    'text-classification', 'token-classification', 'question-answering',
    'summarization', 'translation', 'text-generation', 'text2text-generation',
    'fill-mask', 'sentence-similarity', 'feature-extraction',
    'zero-shot-classification', 'conversational',
    'image-classification', 'object-detection', 'image-segmentation',
    'text-to-image', 'image-to-text', 'image-to-image',
    'automatic-speech-recognition', 'audio-classification', 'text-to-speech',
    'audio-to-audio', 'tabular-classification', 'tabular-regression',
    'reinforcement-learning', 'robotics', 'video-classification',
    'visual-question-answering', 'document-question-answering'
  ];

  var DOWNLOAD_STEPS = [0, 1000, 10000, 100000, 1000000, 10000000, 100000000];

  function formatDownloadStep(value) {
    if (value === 0) return 'Any';
    if (value >= 1000000) return (value / 1000000) + 'M+';
    if (value >= 1000) return (value / 1000) + 'k+';
    return String(value) + '+';
  }

  function formatCount(value) {
    return (typeof value === 'number' ? value : 0).toLocaleString();
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, ms);
    };
  }

  // ---- DOM refs ----
  var els = {
    search: document.getElementById('search-input'),
    task: document.getElementById('task-select'),
    language: document.getElementById('language-select'),
    license: document.getElementById('license-select'),
    sort: document.getElementById('sort-select'),
    slider: document.getElementById('downloads-slider'),
    sliderValue: document.getElementById('downloads-value'),
    loading: document.getElementById('loading-state'),
    error: document.getElementById('error-state'),
    empty: document.getElementById('empty-state'),
    resultsList: document.getElementById('results-list'),
    shortlistCount: document.getElementById('shortlist-count'),
    shortlistList: document.getElementById('shortlist-list'),
    shortlistEmpty: document.getElementById('shortlist-empty'),
    copyMarkdownBtn: document.getElementById('copy-markdown-btn'),
    compareBtn: document.getElementById('compare-btn'),
    clearShortlistBtn: document.getElementById('clear-shortlist-btn'),
    compareModal: document.getElementById('compare-modal'),
    compareTableWrap: document.getElementById('compare-table-wrap'),
    closeCompareBtn: document.getElementById('close-compare-btn'),
    toast: document.getElementById('toast')
  };

  // ---- state ----
  var state = {
    rawResults: [],
    shortlist: loadShortlist(),
    activeFetchId: 0
  };

  function loadShortlist() {
    try {
      var raw = window.localStorage.getItem(SHORTLIST_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveShortlist() {
    try {
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(state.shortlist));
    } catch (err) {
      // localStorage unavailable (private mode, quota, etc.) — shortlist just won't persist.
    }
  }

  function isStarred(id) {
    return state.shortlist.some(function (m) { return m.id === id; });
  }

  function toggleStar(model) {
    var normalized = HFScout.normalizeModel(model);
    var idx = state.shortlist.findIndex(function (m) { return m.id === normalized.id; });
    if (idx === -1) {
      state.shortlist.push(model);
    } else {
      state.shortlist.splice(idx, 1);
    }
    saveShortlist();
    renderShortlist();
    renderResults();
  }

  // ---- populate static controls ----
  function populateTaskOptions() {
    PIPELINE_TASKS.forEach(function (task) {
      var opt = document.createElement('option');
      opt.value = task;
      opt.textContent = task;
      els.task.appendChild(opt);
    });
  }

  function populateSliderLabel() {
    var idx = Number(els.slider.value);
    els.sliderValue.textContent = formatDownloadStep(DOWNLOAD_STEPS[idx]);
  }

  function currentMinDownloads() {
    var idx = Number(els.slider.value);
    return DOWNLOAD_STEPS[idx] || 0;
  }

  function repopulateDynamicFilters() {
    var languages = HFScout.collectLanguages(state.rawResults);
    var licenses = HFScout.collectLicenses(state.rawResults);

    fillSelectPreservingValue(els.language, languages, 'all', 'All languages');
    fillSelectPreservingValue(els.license, licenses, 'all', 'All licenses');
  }

  function fillSelectPreservingValue(select, values, allValue, allLabel) {
    var prev = select.value;
    select.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = allValue;
    allOpt.textContent = allLabel;
    select.appendChild(allOpt);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    var stillValid = values.indexOf(prev) !== -1 || prev === allValue;
    select.value = stillValid ? prev : allValue;
  }

  // ---- status helpers ----
  function setLoading(isLoading) {
    els.loading.classList.toggle('hidden', !isLoading);
  }

  function setError(message) {
    if (message) {
      els.error.textContent = message;
      els.error.classList.remove('hidden');
    } else {
      els.error.classList.add('hidden');
      els.error.textContent = '';
    }
  }

  function setEmpty(isEmpty) {
    els.empty.classList.toggle('hidden', !isEmpty);
  }

  // ---- fetching ----
  function buildUrl() {
    var params = new URLSearchParams();
    var q = els.search.value.trim();
    if (q) params.set('search', q);
    if (els.task.value) params.set('pipeline_tag', els.task.value);
    params.set('sort', 'downloads');
    params.set('direction', '-1');
    params.set('limit', String(FETCH_LIMIT));
    params.set('full', 'false');
    return API_BASE + '?' + params.toString();
  }

  function fetchModels() {
    var fetchId = ++state.activeFetchId;
    setError(null);
    setEmpty(false);
    setLoading(true);
    els.resultsList.innerHTML = '';

    fetch(buildUrl())
      .then(function (res) {
        if (!res.ok) {
          throw new Error('Hugging Face API returned ' + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        if (fetchId !== state.activeFetchId) return; // stale response
        state.rawResults = Array.isArray(data) ? data : [];
        setLoading(false);
        repopulateDynamicFilters();
        renderResults();
      })
      .catch(function (err) {
        if (fetchId !== state.activeFetchId) return;
        setLoading(false);
        state.rawResults = [];
        renderResults();
        setError('Could not load models: ' + err.message);
      });
  }

  var debouncedFetch = debounce(fetchModels, SEARCH_DEBOUNCE_MS);

  // ---- rendering ----
  function renderResults() {
    var filtered = HFScout.filterModels(state.rawResults, {
      language: els.language.value,
      license: els.license.value,
      minDownloads: currentMinDownloads()
    });
    var sorted = HFScout.sortModels(filtered, els.sort.value);

    els.resultsList.innerHTML = '';
    setEmpty(sorted.length === 0 && !isLoadingVisible());

    sorted.forEach(function (raw) {
      els.resultsList.appendChild(renderCard(raw));
    });
  }

  function isLoadingVisible() {
    return !els.loading.classList.contains('hidden');
  }

  function renderCard(raw) {
    var m = HFScout.normalizeModel(raw);
    var li = document.createElement('li');
    li.className = 'model-card';

    var top = document.createElement('div');
    top.className = 'model-card-top';

    var idWrap = document.createElement('div');
    idWrap.className = 'model-id';
    var link = document.createElement('a');
    link.href = m.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = m.id;
    idWrap.appendChild(link);

    var starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'star-btn' + (isStarred(m.id) ? ' starred' : '');
    starBtn.setAttribute('aria-pressed', isStarred(m.id) ? 'true' : 'false');
    starBtn.setAttribute('aria-label', isStarred(m.id) ? 'Remove from shortlist' : 'Add to shortlist');
    starBtn.textContent = isStarred(m.id) ? '★' : '☆';
    starBtn.addEventListener('click', function () {
      toggleStar(raw);
    });

    top.appendChild(idWrap);
    top.appendChild(starBtn);

    var meta = document.createElement('div');
    meta.className = 'model-meta';
    meta.appendChild(pill(m.pipelineTag));
    meta.appendChild(pill(m.license));
    if (m.languages.length) {
      meta.appendChild(pill(m.languages.join(', ')));
    }

    var stats = document.createElement('div');
    stats.className = 'model-stats';
    var downloadsSpan = document.createElement('span');
    downloadsSpan.textContent = '⬇ ' + formatCount(m.downloads);
    var likesSpan = document.createElement('span');
    likesSpan.textContent = '♥ ' + formatCount(m.likes);
    stats.appendChild(downloadsSpan);
    stats.appendChild(likesSpan);

    li.appendChild(top);
    li.appendChild(meta);
    li.appendChild(stats);
    return li;
  }

  function pill(text) {
    var span = document.createElement('span');
    span.className = 'pill';
    span.textContent = text;
    return span;
  }

  function renderShortlist() {
    els.shortlistCount.textContent = '(' + state.shortlist.length + ')';
    els.shortlistList.innerHTML = '';
    els.shortlistEmpty.classList.toggle('hidden', state.shortlist.length > 0);
    els.compareBtn.disabled = state.shortlist.length === 0;

    state.shortlist.forEach(function (raw) {
      var m = HFScout.normalizeModel(raw);
      var li = document.createElement('li');
      li.className = 'shortlist-item';

      var label = document.createElement('label');
      var textSpan = document.createElement('span');
      textSpan.className = 'model-id-text';
      textSpan.textContent = m.id;
      label.appendChild(textSpan);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'Remove ' + m.id + ' from shortlist');
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', function () {
        toggleStar(raw);
      });

      li.appendChild(label);
      li.appendChild(removeBtn);
      els.shortlistList.appendChild(li);
    });
  }

  // ---- markdown copy ----
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      els.toast.classList.add('hidden');
    }, 2200);
  }

  function copyShortlistMarkdown() {
    var markdown = HFScout.toMarkdownTable(state.shortlist);
    var done = function () { showToast('Shortlist copied as Markdown'); };
    var fail = function () { showToast('Could not copy — see console'); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(markdown).then(done, function () {
        legacyCopy(markdown, done, fail);
      });
    } else {
      legacyCopy(markdown, done, fail);
    }
  }

  function legacyCopy(text, done, fail) {
    try {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) done(); else fail();
    } catch (err) {
      fail();
    }
  }

  // ---- compare modal ----
  function openCompare() {
    var models = state.shortlist.slice(0, MAX_COMPARE).map(HFScout.normalizeModel);
    var table = document.createElement('table');
    table.className = 'compare-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Field'].concat(models.map(function (m) { return m.id; })).forEach(function (text) {
      var th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var rowsDef = [
      { label: 'Task', get: function (m) { return m.pipelineTag; } },
      { label: 'Downloads', get: function (m) { return formatCount(m.downloads); } },
      { label: 'Likes', get: function (m) { return formatCount(m.likes); } },
      { label: 'License', get: function (m) { return m.license; } },
      { label: 'Languages', get: function (m) { return m.languages.join(', ') || '—'; } },
      { label: 'Link', get: function (m) { return m.url; } }
    ];

    var tbody = document.createElement('tbody');
    rowsDef.forEach(function (rowDef) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.textContent = rowDef.label;
      tr.appendChild(th);
      models.forEach(function (m) {
        var td = document.createElement('td');
        if (rowDef.label === 'Link') {
          var a = document.createElement('a');
          a.href = m.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = 'Open ↗';
          td.appendChild(a);
        } else {
          td.textContent = rowDef.get(m);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    els.compareTableWrap.innerHTML = '';
    if (models.length === 0) {
      els.compareTableWrap.textContent = 'Star at least one model to compare.';
    } else {
      els.compareTableWrap.appendChild(table);
    }

    els.compareModal.classList.remove('hidden');
  }

  function closeCompare() {
    els.compareModal.classList.add('hidden');
  }

  // ---- wire up events ----
  function init() {
    populateTaskOptions();
    populateSliderLabel();
    renderShortlist();

    els.search.addEventListener('input', debouncedFetch);
    els.task.addEventListener('change', fetchModels);
    els.language.addEventListener('change', renderResults);
    els.license.addEventListener('change', renderResults);
    els.sort.addEventListener('change', renderResults);
    els.slider.addEventListener('input', function () {
      populateSliderLabel();
      renderResults();
    });

    els.copyMarkdownBtn.addEventListener('click', copyShortlistMarkdown);
    els.compareBtn.addEventListener('click', openCompare);
    els.closeCompareBtn.addEventListener('click', closeCompare);
    els.compareModal.addEventListener('click', function (evt) {
      if (evt.target === els.compareModal) closeCompare();
    });
    els.clearShortlistBtn.addEventListener('click', function () {
      if (state.shortlist.length === 0) return;
      state.shortlist = [];
      saveShortlist();
      renderShortlist();
      renderResults();
    });

    fetchModels();
  }

  init();
})();
