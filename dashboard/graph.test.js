'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./dashboard-model.js');
const notes = [
 {id:'a/1',member:'a',title:'One',created:'2026-10-24',tags:['shared','solo','third','fourth']},
 {id:'a/2',member:'a',title:'Two',created:'invalid',tags:['solo']},
 {id:'b/1',member:'b',title:'Three',created:'2026-10-23',tags:['shared']}
];
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
