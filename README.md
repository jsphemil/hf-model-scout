# HF Model Scout

A small, static web app for searching the [Hugging Face Hub](https://huggingface.co/models), filtering results, and building a shortlist to compare or share.

No frameworks, no build step, no API keys — it's plain HTML/CSS/JS calling the public Hugging Face Hub API directly from the browser.

## Features

- Search box (debounced) backed by the Hub's `/api/models` search endpoint
- Filter by task (pipeline tag), language, license, and a minimum-downloads slider
- Sort by downloads, likes, or most recently updated
- Result cards showing model id, task, downloads, likes, license, and a link to the model page
- Star models into a shortlist, persisted in `localStorage`
- "Copy shortlist as Markdown" — copies a Markdown table to the clipboard
- Compare view for up to 3 starred models, side by side
- Mobile-first layout, dark mode via `prefers-color-scheme`
- Loading, error, and "no results" states

## Project structure

```
docs/
  index.html    # markup
  style.css     # styling, mobile-first, dark mode
  app.js        # app logic: fetching, rendering, shortlist, compare
  filters.js    # pure data helpers (license/language parsing, filter, sort,
                #   markdown export) — no DOM, no fetch, shared with tests
tests/
  sample-models.json    # saved sample Hub API response used by tests
  filter-sort.test.js   # Node test script for filters.js (no network calls)
```

## Running locally

Since it's a static site, any local web server works, e.g.:

```bash
cd docs
python3 -m http.server 8000
# open http://localhost:8000
```

The app talks to `https://huggingface.co/api/models` directly from your browser, so it needs network access to Hugging Face but nothing else — no backend, no API key.

## Running the tests

```bash
npm test
# or directly:
node --test tests/filter-sort.test.js
```

The tests exercise the filtering/sorting/markdown-export logic in `docs/filters.js` against a saved sample API response in `tests/sample-models.json`. They make no network calls.

## Deploying to GitHub Pages

1. Push this repository to GitHub (already done if you're reading this from the repo).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Choose the branch this app lives on (e.g. `main`) and set the folder to **`/docs`**.
5. Save. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/` within a minute or two.
6. Revisit **Settings → Pages** to confirm the URL once the first deployment finishes.

No further configuration is needed — the app is fully static and requires no environment variables or secrets.

## Notes on the data

- Language and license aren't separate top-level fields in the Hub API's default response; they're encoded as tags (e.g. `license:apache-2.0`, `en`). `docs/filters.js` extracts them: license from the `license:` tag, and language from a whitelist of ISO 639-1 codes (plus `multilingual`) so library/architecture tags (e.g. `pytorch`, `bert`) aren't mistaken for languages.
- The app fetches the top 100 results (by downloads) for the current search/task, then applies language, license, minimum-downloads, and sort client-side — so switching those filters is instant and doesn't refetch.
