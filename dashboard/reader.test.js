'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = fs.existsSync(`${__dirname}/reader.js`) ? require('./reader.js') : {};
const page = 'https://example.org/study/reader.html?note=a';
const note = {id:'a',asset_base:'./content/members/alice/notes/chapter/'};
const other = {id:'b',asset_base:'./content/members/alice/notes/',source_url:'https://github.com/org/repo/blob/main/members/alice/notes/other.md',url:'./reader.html?note=b'};
test('reader exports browser-testable rendering and resolution functions',()=>{
 for(const name of ['resolveURL','safeURL','originalHTMLURL','markdown','findNote']) assert.equal(typeof R[name],'function',name);
});
test('relative assets resolve from the note directory, not the reader page',()=>{
 assert.equal(R.resolveURL('images/a.png',note,[],page),'https://example.org/study/content/members/alice/notes/chapter/images/a.png');
 assert.equal(R.resolveURL('#section',note,[],page),'#section');
});
test('indexed local notes and source URLs become internal deep links',()=>{
 assert.equal(R.resolveURL('../other.md#question',note,[other],page),'https://example.org/study/reader.html?note=b#question');
 assert.equal(R.resolveURL(other.source_url,note,[other],page),'https://example.org/study/reader.html?note=b');
});
test('unsafe URL schemes and credentials are rejected',()=>{
 for(const url of [undefined,null,'','   ','javascript:alert(1)','data:text/html,x','https://user:pass@example.org','vbscript:x']) assert.equal(R.safeURL(url,page),'');
 assert.equal(R.safeURL('https://example.org/a',page),'https://example.org/a');
});
test('note lookup preserves exact IDs and handles missing or malformed indexes',()=>{
 assert.equal(R.findNote({notes:[{id:'a/b'}]},'?note=a%2Fb').id,'a/b');
 assert.equal(R.findNote({notes:[]},'?note=missing'),null);
 assert.throws(()=>R.findNote({},'?note=a'),/형식/);
});
test('dashboard app only opens cross-origin links in new tabs',()=>{
 assert.match(fs.readFileSync(`${__dirname}/app.js`,'utf8'),/u\.origin\s*!==\s*location\.origin/);
});
test('graph popovers do not force internal links into a new tab',()=>{
 assert.doesNotMatch(fs.readFileSync(`${__dirname}/graph.js`,'utf8'),/href: node\.url, target: '_blank'/);
});
test('original HTML URL encodes filenames within same-origin content/members',()=>{
 assert.equal(R.originalHTMLURL({path:'members/alice/notes/한 글 #?.html'},page),'https://example.org/study/content/members/alice/notes/%ED%95%9C%20%EA%B8%80%20%23%3F.html');
 assert.equal(R.originalHTMLURL({path:'members/alice/notes/100%.html'},page),'https://example.org/study/content/members/alice/notes/100%25.html');
 for(const path of [undefined,'','/members/a.html','https://evil.test/members/a.html','//evil.test/a.html','members/../a.html','members/a/../../a.html','members/a/./b.html','members/a\\b.html','members//a.html','members/a/%2e%2e/x.html','members/a/%252e%252e/x.html','members/a/%2f/x.html','members/a/\u0000.html','members-evil/a.html']) assert.throws(()=>R.originalHTMLURL({path},page),/경로/,String(path));
});
test('original HTML URL forwards the reader fragment without treating it as a filename',()=>{
 const html={path:'members/alice/notes/chapter.html'};
 assert.equal(R.originalHTMLURL(html,page+'#part'),'https://example.org/study/content/members/alice/notes/chapter.html#part');
 assert.equal(R.originalHTMLURL(html,page+'#%ED%95%9C%EA%B8%80'),'https://example.org/study/content/members/alice/notes/chapter.html#%ED%95%9C%EA%B8%80');
});
test('Markdown links to indexed HTML preserve the section fragment',()=>{
 const html={id:'html',source_url:'https://github.com/org/repo/blob/main/members/alice/notes/chapter/original.html',asset_base:note.asset_base};
 assert.equal(R.resolveURL('original.html#part',note,[html],page),'https://example.org/study/reader.html?note=html#part');
});
test('HTML is not sanitized or wrapped in standalone reader chrome',()=>{
 const js=fs.readFileSync(`${__dirname}/reader.js`,'utf8');
 const css=fs.readFileSync(`${__dirname}/reader.css`,'utf8');
 const html=fs.readFileSync(`${__dirname}/reader.html`,'utf8');
 assert.doesNotMatch(js,/htmlDocument|\.srcdoc\s*=|Content-Security-Policy|html-standalone/);
 assert.doesNotMatch(css,/html-standalone/);
 assert.match(html,/원본 HTML/);assert.match(html,/스크립트/);assert.match(html,/저장소/);assert.doesNotMatch(html,/차단됩니다|읽기 전용/);
 assert.ok(html.includes('reader.css?v=reader-3'));
 assert.ok(html.includes('reader.js?v=reader-4'));
});
test('reader shell loads pinned local dependencies for Markdown',()=>{
 const html=fs.readFileSync(`${__dirname}/reader.html`,'utf8');
 assert.match(html,/vendor\/marked-15\.0\.12\.umd\.js/);
 assert.match(html,/vendor\/purify-3\.4\.17\.min\.js/);
 assert.doesNotMatch(html,/allow-scripts|allow-same-origin/);
});
