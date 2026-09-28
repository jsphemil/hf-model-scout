/**
 * Pure data helpers for HF Model Scout: license/language extraction,
 * filtering, sorting, and markdown export. No DOM, no fetch — so the
 * exact same file can be loaded in the browser and required from the
 * Node test script.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HFScout = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ISO 639-1 codes, plus a few multi-part / catch-all tags the Hub uses.
  // HF model tags mix languages in with library/arch/format tags with no
  // separator, so we whitelist known language codes rather than guess.
  var LANGUAGE_CODES = new Set([
    'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az',
    'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br', 'bs',
    'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy',
    'da', 'de', 'dv', 'dz',
    'ee', 'el', 'en', 'eo', 'es', 'et', 'eu',
    'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy',
    'ga', 'gd', 'gl', 'gn', 'gu', 'gv',
    'ha', 'he', 'hi', 'ho', 'hr', 'ht', 'hu', 'hy', 'hz',
    'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu',
    'ja', 'jv',
    'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky',
    'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv',
    'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my',
    'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny',
    'oc', 'oj', 'om', 'or', 'os',
    'pa', 'pi', 'pl', 'ps', 'pt',
    'qu',
    'rm', 'rn', 'ro', 'ru', 'rw',
    'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw',
    'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty',
    'ug', 'uk', 'ur', 'uz',
    've', 'vi', 'vo',
    'wa', 'wo',
    'xh',
    'yi', 'yo', 'yue',
    'za', 'zh', 'zu',
    'multilingual'
  ]);

  function getLicense(model) {
    var tags = model.tags || [];
    for (var i = 0; i < tags.length; i++) {
      if (typeof tags[i] === 'string' && tags[i].indexOf('license:') === 0) {
        return tags[i].slice('license:'.length);
      }
    }
    return model.license || 'unknown';
  }

  function getLanguages(model) {
    var tags = model.tags || [];
    var found = [];
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      if (typeof tag === 'string' && tag.indexOf(':') === -1 && LANGUAGE_CODES.has(tag.toLowerCase())) {
        found.push(tag.toLowerCase());
      }
    }
    return found;
  }

  function normalizeModel(model) {
    var id = model.id || model.modelId || '';
    return {
      id: id,
      pipelineTag: model.pipeline_tag || 'unknown',
      downloads: typeof model.downloads === 'number' ? model.downloads : 0,
      likes: typeof model.likes === 'number' ? model.likes : 0,
      license: getLicense(model),
      languages: getLanguages(model),
      lastModified: model.lastModified || model.createdAt || null,
      url: 'https://huggingface.co/' + id
    };
  }

  function filterModels(models, filters) {
    filters = filters || {};
    var language = filters.language;
    var license = filters.license;
    var minDownloads = typeof filters.minDownloads === 'number' ? filters.minDownloads : 0;

    return models.filter(function (raw) {
      var m = normalizeModel(raw);
      if (m.downloads < minDownloads) return false;
      if (license && license !== 'all' && m.license !== license) return false;
      if (language && language !== 'all' && m.languages.indexOf(language) === -1) return false;
      return true;
    });
  }

  function sortModels(models, sortBy) {
    var copy = models.slice();
    copy.sort(function (a, b) {
      var na = normalizeModel(a);
      var nb = normalizeModel(b);
      if (sortBy === 'likes') {
        return nb.likes - na.likes;
      }
      if (sortBy === 'updated') {
        var ta = na.lastModified ? Date.parse(na.lastModified) : 0;
        var tb = nb.lastModified ? Date.parse(nb.lastModified) : 0;
        return tb - ta;
      }
      // default: downloads
      return nb.downloads - na.downloads;
    });
    return copy;
  }

  function collectLicenses(models) {
    var set = new Set();
    models.forEach(function (raw) {
      set.add(getLicense(raw));
    });
    return Array.from(set).sort();
  }

  function collectLanguages(models) {
    var set = new Set();
    models.forEach(function (raw) {
      getLanguages(raw).forEach(function (lang) {
        set.add(lang);
      });
    });
    return Array.from(set).sort();
  }

  function escapeMarkdownCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|');
  }

  function toMarkdownTable(shortlist) {
    if (!shortlist || shortlist.length === 0) {
      return '_No models shortlisted yet._';
    }
    var header = '| Model | Task | Downloads | Likes | License | Link |';
    var divider = '| --- | --- | --- | --- | --- | --- |';
    var rows = shortlist.map(function (raw) {
      var m = normalizeModel(raw);
      return '| ' + [
        escapeMarkdownCell(m.id),
        escapeMarkdownCell(m.pipelineTag),
        escapeMarkdownCell(m.downloads.toLocaleString()),
        escapeMarkdownCell(m.likes.toLocaleString()),
        escapeMarkdownCell(m.license),
        escapeMarkdownCell(m.url)
      ].join(' | ') + ' |';
    });
    return [header, divider].concat(rows).join('\n');
  }

  return {
    LANGUAGE_CODES: LANGUAGE_CODES,
    getLicense: getLicense,
    getLanguages: getLanguages,
    normalizeModel: normalizeModel,
    filterModels: filterModels,
    sortModels: sortModels,
    collectLicenses: collectLicenses,
    collectLanguages: collectLanguages,
    toMarkdownTable: toMarkdownTable
  };
});
