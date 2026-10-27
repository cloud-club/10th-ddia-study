'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./dashboard-model.js');
const notes = [
 {id:'a/1',member:'a',title:'One',created:'2026-10-24',tags:['shared','solo','third','fourth']},
 {id:'a/2',member:'a',title:'Two',created:'invalid',tags:['solo']},
 {id:'b/1',member:'b',title:'Three',created:'2026-10-23',tags:['shared']}
];
test('dashboard shell cache-busts the identity-aware model',()=>{
 const html=require('node:fs').readFileSync(`${__dirname}/index.html`,'utf8');
 assert.ok(html.includes('dashboard-model.js?v=readiness-2'));
});
test('member photos survive both generated and source graph paths', () => {
 const fallback=model.graphForNotes(notes).nodes.find(n=>n.id==='member:a');
 assert.equal(fallback.avatar,'https://github.com/a.png?size=160');
 const source={nodes:[{id:'member:a',type:'member',label:'a',avatar:'https://github.com/a.png?size=160'},{id:'note:a/1',type:'note',label:'One'}],edges:[{source:'member:a',target:'note:a/1',type:'authored'}]};
 assert.equal(model.graphForNotes([notes[0]],source).nodes.find(n=>n.type==='member').avatar,fallback.avatar);
});
test('graph maps actual authors and keeps complete document tags', () => {
 const graph=model.graphForNotes(notes);
 assert.equal(graph.nodes.filter(n=>n.type==='member').length,2);
 assert.equal(graph.links.length,9);
 assert.equal(graph.nodes.find(n=>n.id==='note:a/1').member,'a');
 assert.deepEqual(graph.nodes.find(n=>n.id==='note:a/1').tags, notes[0].tags);
});
test('shared topics count distinct authors, filling only up to three by degree', () => {
 const graph=model.graphForNotes(notes);
 assert.deepEqual([...model.initialTopics(graph)].sort(),['topic:shared','topic:solo','topic:third'].sort());
 assert.equal(model.topicStats(graph).members.get('topic:solo').size,1);
});
test('metadata payload supports native graph IDs without inventing edges', () => {
 const graph=model.graphForNotes([notes[0]],{nodes:[{id:'custom',type:'note',label:'One',url:'x'},{id:'m',type:'member',label:'a'},{id:'t',type:'topic',label:'shared'}],edges:[{source:'m',target:'custom',type:'authored'},{source:'custom',target:'t',type:'tagged'}]});
 assert.equal(graph.links.length,2);
 assert.equal(graph.nodes.find(n=>n.id==='custom').member,'a');
});
test('duplicate titles retain only exact selected IDs, URLs and authorship', () => {
 const duplicates=[
  {id:'alice/one',member:'alice',title:'Same title',url:'./reader.html?note=alice%2Fone'},
  {id:'bob/one',member:'bob',title:'Same title',url:'./reader.html?note=bob%2Fone'},
  {id:'alice/two',member:'alice',title:'Same title',url:'./reader.html?note=alice%2Ftwo'}
 ];
 const full=model.graphForNotes(duplicates);
 const source={nodes:full.nodes,edges:full.links};
 for(const selected of duplicates){
  const filtered=model.graphForNotes([selected],source);
  assert.deepEqual(filtered.nodes.filter(n=>n.type==='note').map(n=>({id:n.id,member:n.member,url:n.url})),[{id:`note:${selected.id}`,member:selected.member,url:selected.url}]);
  assert.deepEqual(filtered.links,[{source:`member:${selected.member}`,target:`note:${selected.id}`,type:'authored'}]);
 }
 const both=model.graphForNotes(duplicates,source);
 assert.deepEqual(both.nodes.filter(n=>n.type==='note').map(n=>n.url),duplicates.map(n=>n.url));
});
test('stable ID and URL matches precede title fallback; known mismatches never fall back',()=>{
 const selected=[{id:'a/one',title:'Shared',member:'a',url:'one'},{id:'b/two',title:'Shared',member:'b',url:'two'}];
 const source={nodes:[{id:'note:b/two',type:'note',label:'Shared'},{id:'native',type:'note',label:'Shared',url:'two'},{id:'note:excluded',type:'note',label:'Shared'},{id:'a/excluded',type:'note',label:'Shared'},{id:'unknown-url',type:'note',label:'Shared',url:'excluded'}],edges:[]};
 const graph=model.graphForNotes(selected,source);
 assert.deepEqual(graph.nodes.map(n=>[n.id,n.member,n.url]),[['note:b/two','b','two'],['native','b','two']]);
});
test('note-based XP and daily counts never imply commits; malformed dates excluded', () => {
 const member=model.memberStats({id:'a',note_count:2},notes);
 assert.equal(member.xp,80); assert.equal(member.level,1); assert.equal(member.xp_in_level,80);
 assert.deepEqual(member.activity,[{date:'2026-10-24',count:1}]);
 assert.equal(member.commits,undefined);
 assert.equal(model.memberStats({id:'b',note_count:5},notes).level,3);
});
test('heatmap uses real dated notes and empty days, not synthetic contributions', () => {
 const cells=model.heatmapDays([{date:'2026-10-24',count:2}],'2026-10-24',84);
 assert.equal(cells.length,84); assert.equal(cells.at(-1).count,2);
 assert.equal(cells.reduce((n,c)=>n+c.count,0),2);
 assert.deepEqual(model.heatmapDays([],null,84),[]);
});
test('filter never includes a sibling note merely because it shares an author', () => {
 assert.deepEqual(model.filterNotes(notes,{member:'a',query:'One'}).map(n=>n.id),['a/1']);
 assert.deepEqual(model.filterNotes(notes,{topic:'shared'}).map(n=>n.id).sort(),['a/1','b/1']);
});
