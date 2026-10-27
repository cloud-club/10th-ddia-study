'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = fs.existsSync(`${__dirname}/reader.js`) ? require('./reader.js') : {};
const page = 'https://example.org/study/reader.html?note=a';
const note = {id:'a',asset_base:'./content/members/alice/notes/chapter/'};
const other = {id:'b',asset_base:'./content/members/alice/notes/',source_url:'https://github.com/org/repo/blob/main/members/alice/notes/other.md',url:'./reader.html?note=b'};
test('reader exports browser-testable rendering and resolution functions',()=>{
 for(const name of ['resolveURL','safeURL','htmlDocument','markdown','findNote']) assert.equal(typeof R[name],'function',name);
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
test('reader shell loads pinned local dependencies and no permissive iframe sandbox',()=>{
 const html=fs.readFileSync(`${__dirname}/reader.html`,'utf8');
 assert.match(html,/vendor\/marked-15\.0\.12\.umd\.js/);
 assert.match(html,/vendor\/purify-3\.4\.17\.min\.js/);
 assert.doesNotMatch(html,/allow-scripts|allow-same-origin/);
});
