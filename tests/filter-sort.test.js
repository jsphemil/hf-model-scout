'use strict';

// Pure logic tests for docs/filters.js — no network calls, no browser.
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const HFScout = require(path.join('..', 'docs', 'filters.js'));

const sampleModels = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'sample-models.json'), 'utf8')
);

test('getLicense reads the license: tag', () => {
  assert.equal(HFScout.getLicense(sampleModels[0]), 'apache-2.0');
  assert.equal(HFScout.getLicense(sampleModels[4]), 'mit');
});

test('getLicense falls back to "unknown" when no license tag or field exists', () => {
  const noTagsModel = sampleModels.find((m) => m.id === 'legacy/no-tags-model');
  assert.equal(HFScout.getLicense(noTagsModel), 'unknown');
});

test('getLanguages extracts whitelisted language codes only', () => {
  const bert = sampleModels.find((m) => m.id === 'google-bert/bert-base-uncased');
  assert.deepEqual(HFScout.getLanguages(bert), ['en']);

  const whisper = sampleModels.find((m) => m.id === 'openai/whisper-large-v3');
  assert.deepEqual(HFScout.getLanguages(whisper).sort(), ['en', 'multilingual', 'zh'].sort());
});

test('getLanguages does not mistake library/arch tags for languages', () => {
  const gpt2 = sampleModels.find((m) => m.id === 'openai-community/gpt2');
  const languages = HFScout.getLanguages(gpt2);
  assert.ok(!languages.includes('gpt2'));
  assert.ok(!languages.includes('pytorch'));
  assert.deepEqual(languages, ['en']);
});

test('getLanguages returns an empty array when there are no tags', () => {
  const noTagsModel = sampleModels.find((m) => m.id === 'legacy/no-tags-model');
  assert.deepEqual(HFScout.getLanguages(noTagsModel), []);
});

test('normalizeModel produces a stable, lean shape', () => {
  const m = HFScout.normalizeModel(sampleModels[0]);
  assert.equal(m.id, 'google-bert/bert-base-uncased');
  assert.equal(m.pipelineTag, 'fill-mask');
  assert.equal(m.downloads, 41700000);
  assert.equal(m.likes, 3381);
  assert.equal(m.license, 'apache-2.0');
  assert.equal(m.url, 'https://huggingface.co/google-bert/bert-base-uncased');
});

test('filterModels applies minDownloads', () => {
  const filtered = HFScout.filterModels(sampleModels, { minDownloads: 10000000 });
  const ids = filtered.map((m) => m.id).sort();
  assert.deepEqual(ids, [
    'google-bert/bert-base-uncased',
    'openai-community/gpt2',
    'sentence-transformers/all-MiniLM-L6-v2'
  ].sort());
});

test('filterModels applies license filter', () => {
  const filtered = HFScout.filterModels(sampleModels, { license: 'mit' });
  const ids = filtered.map((m) => m.id).sort();
  assert.deepEqual(ids, ['openai-community/gpt2', 'camembert-base'].sort());
});

test('filterModels applies language filter', () => {
  const filtered = HFScout.filterModels(sampleModels, { language: 'fr' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'camembert-base');
});

test('filterModels combines license, language, and minDownloads filters (AND)', () => {
  const filtered = HFScout.filterModels(sampleModels, {
    license: 'apache-2.0',
    language: 'en',
    minDownloads: 5000000
  });
  const ids = filtered.map((m) => m.id).sort();
  assert.deepEqual(ids, [
    'google-bert/bert-base-uncased',
    'distilbert/distilbert-base-uncased-finetuned-sst-2-english',
    'sentence-transformers/all-MiniLM-L6-v2'
  ].sort());
});

test('filterModels with "all" sentinel values behaves like no filter', () => {
  const filtered = HFScout.filterModels(sampleModels, { license: 'all', language: 'all', minDownloads: 0 });
  assert.equal(filtered.length, sampleModels.length);
});

test('filterModels returns an empty array when nothing matches, without throwing', () => {
  const filtered = HFScout.filterModels(sampleModels, { minDownloads: 999999999 });
  assert.deepEqual(filtered, []);
});

test('filterModels on an empty input returns an empty array', () => {
  assert.deepEqual(HFScout.filterModels([], { minDownloads: 0 }), []);
});

test('sortModels orders by downloads descending by default', () => {
  const sorted = HFScout.sortModels(sampleModels, 'downloads');
  assert.equal(sorted[0].id, 'sentence-transformers/all-MiniLM-L6-v2');
  assert.equal(sorted[sorted.length - 1].id, 'legacy/no-tags-model');
});

test('sortModels orders by likes descending', () => {
  const sorted = HFScout.sortModels(sampleModels, 'likes');
  assert.equal(sorted[0].id, 'google-bert/bert-base-uncased'); // 3381 likes, the most in the sample
});

test('sortModels orders by most recently updated', () => {
  const sorted = HFScout.sortModels(sampleModels, 'updated');
  assert.equal(sorted[0].id, 'some-org/private-preview-model'); // lastModified 2024-04-01, the latest
  assert.equal(sorted[sorted.length - 1].id, 'legacy/no-tags-model'); // 2020-01-01, the oldest
});

test('sortModels does not mutate the input array', () => {
  const original = sampleModels.slice();
  HFScout.sortModels(sampleModels, 'likes');
  assert.deepEqual(sampleModels, original);
});

test('collectLicenses returns sorted unique licenses, including "unknown"', () => {
  const licenses = HFScout.collectLicenses(sampleModels);
  assert.deepEqual(licenses, [...licenses].sort());
  assert.ok(licenses.includes('apache-2.0'));
  assert.ok(licenses.includes('mit'));
  assert.ok(licenses.includes('unknown'));
});

test('collectLanguages returns sorted unique language codes', () => {
  const languages = HFScout.collectLanguages(sampleModels);
  assert.deepEqual(languages, [...languages].sort());
  assert.ok(languages.includes('en'));
  assert.ok(languages.includes('fr'));
  assert.ok(languages.includes('multilingual'));
});

test('toMarkdownTable renders a header and one row per shortlisted model', () => {
  const shortlist = sampleModels.slice(0, 2);
  const md = HFScout.toMarkdownTable(shortlist);
  const lines = md.split('\n');
  assert.equal(lines.length, 4); // header + divider + 2 rows
  assert.match(lines[0], /Model.*Task.*Downloads.*Likes.*License.*Link/);
  assert.match(lines[2], /google-bert\/bert-base-uncased/);
});

test('toMarkdownTable handles an empty shortlist gracefully', () => {
  const md = HFScout.toMarkdownTable([]);
  assert.match(md, /no models shortlisted/i);
});
