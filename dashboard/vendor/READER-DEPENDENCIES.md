# Reader dependencies

The reader uses actual published npm package files, copied unchanged after a pinned `npm install` into a temporary directory. No CDN or runtime package manager is required.

| Local file | Published package file | License |
| --- | --- | --- |
| `marked-15.0.12.umd.js` | `marked@15.0.12/lib/marked.umd.js` | MIT, see `MARKED-LICENSE.md` |
| `purify-3.4.17.min.js` | `dompurify@3.4.17/dist/purify.min.js` | Apache-2.0 OR MPL-2.0, see `DOMPURIFY-LICENSE` |

Package archives:

- <https://registry.npmjs.org/marked/-/marked-15.0.12.tgz>
- <https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz>

SHA-256 of the vendored JavaScript:

```text
d7931d1cd7bf727dd756c871637edcc9e0f8538003b927368400ec1ee47a9dd9  marked-15.0.12.umd.js
cd37898f9782adf54820c413191b5691803f0f137c799d6edcfd38523b4c2c31  purify-3.4.17.min.js
```

To update, download an explicitly pinned release, copy the published browser bundle and license, update reader HTML references and tests, record the new hash here, then run both reader test commands.

## Reader verification

Pure tests require only Node:

```sh
node --test dashboard/*.test.js
```

Browser tests use Playwright installed outside the repository. Replace `/path/to/qa` with a scratch directory:

```sh
npm install --prefix /path/to/qa --no-audit --no-fund playwright@1.64.1
/path/to/qa/node_modules/.bin/playwright install chromium
NODE_PATH=/path/to/qa/node_modules node --test dashboard/reader.browser.cjs
```

The browser suite starts and stops its own loopback HTTP server. Test notes and assets are in-memory HTTP responses, never member files or modifications to `data.json`.

HTML documents are sanitized and displayed in an opaque-origin `sandbox=""` iframe with scripts, forms, objects, subframes, and network APIs blocked by CSP. Original CSS and image/font loading remain available. Non-fragment navigation inside the iframe is removed; its safe document links are exposed below the iframe in the parent reader, where indexed notes route internally. Script-dependent diagrams or presentation controls are intentionally inactive. The original source remains available through the GitHub link.
