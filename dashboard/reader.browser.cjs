'use strict';
// Run: NODE_PATH=/path/to/playwright/node_modules node --test dashboard/reader.browser.cjs
// Fixtures exist only in HTTP route responses; no member or generated payload is written.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
let server,browser,base;
const first={id:'test/nested',title:'질문에서 시작하는 읽기',member:'reader-test',created:'2026-10-27',status:'completed',tags:['storage'],format:'markdown',asset_base:'./content/members/reader-test/notes/nested/',source_url:'https://github.com/example/repo/blob/main/members/reader-test/notes/nested/one.md',url:'./reader.html?note=test%2Fnested',content:'# 첫 질문\n\n노트 본문입니다.\n\n## 질문\n\n[다음 노트](../two.md#질문)\n\n![figure](figure.svg)\n\n| Column | Wide |\n|---|---|\n|'+ 'longword'.repeat(80)+'|value|\n\n```sql\nSELECT '+ 'column_'.repeat(160)+';\n```\n\n<script>window.pwned=1</script><img src=x onerror="window.pwned=1"><iframe src="https://evil.test"></iframe><form><input></form><a href="javascript:alert(1)">bad</a>'};
const second={...first,id:'test/two',title:'두 번째 노트',asset_base:'./content/members/reader-test/notes/',source_url:'https://github.com/example/repo/blob/main/members/reader-test/notes/two.md',url:'./reader.html?note=test%2Ftwo',content:'## 질문\n\n다음 질문입니다.'};
const html={...first,id:'test/html',title:'HTML 원문',format:'html',content:'<!doctype html><html><head><base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test"><style>body{background:rgb(12, 34, 56);color:white}.original{font-size:29px}</style><link rel="stylesheet" href="original.css"></head><body><p class="original">Original style</p><img src="figure.svg"><a href="../two.md">다음 HTML 링크</a><a href="#part" target="_top">section</a><h2 id="part">Part</h2><a href="javascript:alert(1)">bad</a><form action="https://evil.test"><input></form><object data="https://evil.test"></object><iframe src="https://evil.test"></iframe><script>parent.pwned=1</script></body></html>'};
const data={notes:[first,second,html],members:[{id:first.member,avatar:'./favicon.svg'}],topics:[]};
before(async()=>{
 server=http.createServer(async(req,res)=>{try{const file=path.resolve(__dirname,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(__dirname+path.sep))throw Error('path');const bytes=await fs.readFile(file.endsWith(path.sep)?file+'index.html':file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/json');res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
async function pageFor(id,options={}){
 const page=await browser.newPage({viewport:options.mobile?{width:375,height:812}:{width:1280,height:950},reducedMotion:'reduce'});
 await page.route('**/data.json*',route=>options.failure?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:data}));
 await page.route('**/content/**',route=>route.request().url().endsWith('.svg')?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>'}):route.fulfill({contentType:'text/css',body:'.original{font-weight:700}'}));
 await page.goto(`${base}/reader.html?note=${encodeURIComponent(id)}`);
 await page.locator(options.failure||id==='missing'?'#reader-status[role=alert]':'#note-article:not([hidden])').waitFor();return page;
}
test('Markdown GFM, metadata, relative assets, safe DOM, and heading anchors',async()=>{
 const p=await pageFor(first.id);
 assert.equal(await p.locator('#note-title').textContent(),first.title);assert.equal(await p.locator('#note-author').textContent(),first.member);
 assert.equal(await p.locator('#note-source').getAttribute('href'),first.source_url);
 assert.equal(await p.locator('#note-body table').count(),1);assert.equal(await p.locator('#note-body pre').count(),1);
 assert.equal(await p.locator('#note-body script,#note-body iframe,#note-body form,#note-body input').count(),0);
 assert.equal(await p.evaluate(()=>window.pwned),undefined);
 assert.equal(await p.locator('#note-body a').filter({hasText:'bad'}).getAttribute('href'),null);
 assert.equal(await p.locator('#note-body h2').getAttribute('id'),'질문');
 assert.match(await p.locator('#note-body img').first().getAttribute('src'),/nested\/figure.svg$/);
 await p.locator('#note-body img').first().scrollIntoViewIfNeeded();
 await p.locator('#note-body img').first().evaluate(img=>img.decode());
 assert.equal(await p.locator('#note-body img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true);
 const safe=await p.evaluate(()=>{const n=document.createElement('div');n.append(window.DDIAReader.markdown({content:'<p style="position:fixed;inset:0">overlay</p>',asset_base:'./'},[]));return n.innerHTML;});
 assert.doesNotMatch(safe,/style=/);
 if(process.env.READER_SCREENSHOT_DIR){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(process.env.READER_SCREENSHOT_DIR,'reader-desktop.png')});}
 await p.close();
});
test('keyboard internal navigation, browser back, direct deep link and dashboard link',async()=>{
 const p=await pageFor(first.id);const link=p.getByRole('link',{name:'다음 노트',exact:true});assert.equal(await link.getAttribute('target'),null);
 await link.focus();await p.keyboard.press('Enter');await p.waitForURL('**/reader.html?note=test%2Ftwo#%EC%A7%88%EB%AC%B8');await p.locator('#note-title').filter({hasText:second.title}).waitFor();
 await p.goBack();await p.locator('#note-title').filter({hasText:first.title}).waitFor();
 await p.goto(`${base}/reader.html?note=test%2Ftwo#%EC%A7%88%EB%AC%B8`);await p.locator('#note-body h2').waitFor();
 assert.equal(await p.locator('.back-link').getAttribute('href'),'./#knowledge');await p.close();
});
test('mobile tables and code scroll locally without page overflow',async()=>{
 const p=await pageFor(first.id,{mobile:true});const sizes=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,blocks:[...document.querySelectorAll('.table-scroll,pre')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth}))}));
 assert.ok(sizes.scroll<=sizes.width,JSON.stringify(sizes));assert.ok(sizes.blocks.every(b=>b.scroll>b.width));await p.close();
});
test('HTML uses opaque no-script sandbox, restrictive CSP, preserved styles and assets',async()=>{
 const p=await pageFor(html.id);const frame=p.locator('#note-body iframe');assert.equal(await frame.getAttribute('sandbox'),'');
 const src=await frame.getAttribute('srcdoc');assert.match(src,/script-src 'none'/);assert.doesNotMatch(src,/<script|<form|<object|<iframe|http-equiv="refresh"/i);assert.doesNotMatch(src,/evil\.test/);
 const f=await frame.elementHandle().then(h=>h.contentFrame());await f.locator('.original').waitFor();
 assert.equal(await f.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(12, 34, 56)');
 assert.equal(await f.locator('.original').evaluate(n=>getComputedStyle(n).fontSize),'29px');
 assert.equal(await f.locator('img').evaluate(n=>n.complete&&n.naturalWidth>0),true);
 assert.equal(await f.locator('a').first().getAttribute('href'),null);assert.equal(await f.locator('base').count(),1);
 assert.equal(await p.evaluate(()=>window.pwned),undefined);
 const outside=p.locator('#document-links a');assert.equal(await outside.count(),1);assert.match(await outside.getAttribute('href'),/reader.html\?note=test%2Ftwo$/);
 await p.close();
});
test('HTML opens in a new tab as a full-viewport document without reader chrome',async()=>{
 const p=await pageFor(html.id);
 const link=p.getByRole('link',{name:'새 탭으로 열기',exact:true});
 assert.equal(await link.getAttribute('target'),'_blank');
 await p.context().route('**/data.json*',route=>route.fulfill({json:data}));
 const popupPromise=p.waitForEvent('popup');await link.click();const popup=await popupPromise;
 await popup.locator('body.html-standalone iframe').waitFor();
 assert.equal(await popup.locator('.room-bar').isVisible(),false);
 assert.equal(await popup.locator('.note-header').isVisible(),false);
 const box=await popup.locator('iframe').boundingBox(),size=popup.viewportSize();
 assert.equal(box.x,0);assert.equal(box.y,0);assert.equal(box.width,size.width);assert.equal(box.height,size.height);
 assert.equal(await popup.locator('iframe').getAttribute('sandbox'),'');
 await popup.close();await p.close();
});
test('missing note and fetch errors show accessible recovery states',async()=>{
 const p=await pageFor('missing');assert.match(await p.locator('#reader-status').textContent(),/찾을 수 없습니다/);assert.equal(await p.locator('#note-article').isVisible(),false);await p.close();
 const q=await pageFor(first.id,{failure:true});assert.match(await q.locator('#reader-status').textContent(),/503/);assert.equal(await q.locator('#retry').isVisible(),true);await q.close();
});
test('dashboard and graph internal links stay in the current tab',async()=>{
 const p=await pageFor(first.id);await p.goto(`${base}/index.html`);await p.locator('#feed h3 a').first().waitFor();assert.equal(await p.locator('#feed h3 a').first().getAttribute('target'),null);
 await p.locator('.node--note').first().focus();await p.keyboard.press('Enter');await p.locator('.graph__pop:not([hidden])').waitFor();assert.equal(await p.locator('.graph__pop-link').getAttribute('target'),null);await p.close();
});
