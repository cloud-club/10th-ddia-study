'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('contribution build instructions use the canonical repository',()=>{assert.match(read('CONTRIBUTING.md'),/--repo-url https:\/\/github.com\/cloud-club\/10th-ddia-study/);assert.doesNotMatch(read('CONTRIBUTING.md'),/https:\/\/github.com\/cloud-club\/ddia-study/);});
test('README explains HTML submissions and PR artifact checks',()=>{const s=read('README.md');assert.match(s,/Markdown.*HTML/);assert.match(s,/PR에서도.*빌드/);assert.match(s,/npm ci/);});
test('browser regression tests gate the Pages artifact upload',()=>{const s=read('.github/workflows/deploy-dashboard.yml');const upload=s.indexOf('- name: Upload dashboard artifact');for(const v of ['npm ci','npx playwright install --with-deps chromium','npm run test:browser'])assert.ok(s.indexOf(v)>0&&s.indexOf(v)<upload,v);const p=JSON.parse(read('package.json'));assert.match(p.devDependencies.playwright,/^\d+\.\d+\.\d+$/);assert.equal(p.scripts['test:browser'],'node --test dashboard/reader.browser.cjs');});
