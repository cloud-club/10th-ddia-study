/* Pure, note-grounded dashboard model. No commit or calendar schedule inference. */
(function(root) {
 'use strict';
 const validDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
 function graphForNotes(notes, source) {
  if(source && Array.isArray(source.nodes) && Array.isArray(source.edges)) {
   const picked = new Set(), nodes=[];
   source.nodes.forEach(n=>{
    if(n.type!=='note') return;
    // Identity is authoritative: a shared title must never resurrect a filtered sibling.
    let note=notes.find(x=>n.id===`note:${x.id}`||n.id===x.id);
    const stableID=typeof n.id==='string'&&(n.id.startsWith('note:')||n.id.includes('/'));
    if(!note&&!stableID) note=notes.find(x=>n.url&&n.url===x.url);
    if(!note&&!stableID&&!(n.url&&notes.some(x=>x.url))) {
     const candidates=notes.filter(x=>n.label===x.title&&(!n.member||n.member===x.member));
     if(candidates.length===1) note=candidates[0];
    }
    if(note){nodes.push({...n,member:note.member,tags:note.tags||[],url:note.url||n.url});picked.add(n.id);}
   });
   const ids=new Set(picked), links=source.edges.filter(l=>{
    const keep=(l.type==='authored'&&picked.has(l.target))||(l.type==='tagged'&&picked.has(l.source));
    if(keep){ids.add(l.source);ids.add(l.target);}return keep;
   }).map(l=>({...l}));
   source.nodes.filter(n=>n.type!=='note'&&ids.has(n.id)).forEach(n=>nodes.push({...n,member:n.type==='member'?(n.member||n.label):undefined}));
   const available=new Set(nodes.map(n=>n.id));
   return {nodes,links:links.filter(l=>available.has(l.source)&&available.has(l.target))};
  }
  const map=new Map(), links=[];
  notes.forEach(n=>{
   const member=`member:${n.member}`, id=`note:${n.id}`;
   map.set(member,{id:member,type:'member',label:n.member,member:n.member,avatar:`https://github.com/${encodeURIComponent(n.member)}.png?size=160`});
   map.set(id,{id,type:'note',label:n.title,url:n.url,member:n.member,tags:[...(n.tags||[])]});
   links.push({source:member,target:id,type:'authored'});
   new Set(n.tags||[]).forEach(tag=>{const topic=`topic:${tag}`;map.set(topic,{id:topic,type:'topic',label:tag});links.push({source:id,target:topic,type:'tagged'});});
  });
  return {nodes:[...map.values()],links};
 }
 function topicStats(graph) {
  const byId=new Map(graph.nodes.map(n=>[n.id,n])),members=new Map(),degree=new Map();
  graph.links.forEach(l=>{const a=byId.get(l.source),b=byId.get(l.target);if(!a||!b)return;const t=a.type==='topic'?a:b.type==='topic'?b:null,d=t===a?b:a;if(!t||d.type!=='note')return;
   if(!members.has(t.id))members.set(t.id,new Set()); if(d.member)members.get(t.id).add(d.member);degree.set(t.id,(degree.get(t.id)||0)+1);
  });return {members,degree};
 }
 function initialTopics(graph) {
  const s=topicStats(graph),keep=new Set([...s.members].filter(([,m])=>m.size>=2).map(([id])=>id));
  [...s.degree].sort((a,b)=>b[1]-a[1]).forEach(([id])=>{if(keep.size<3)keep.add(id);});return keep;
 }
 function memberStats(member,notes) {
  const own=notes.filter(n=>n.member===member.id),count=Number.isFinite(member.note_count)?member.note_count:own.length,xp=count*40,days=new Map();
  own.forEach(n=>{if(validDate(n.created))days.set(n.created,(days.get(n.created)||0)+1);});
  return {...member,note_count:count,xp,level:Math.floor(xp/100)+1,xp_in_level:xp%100,activity:[...days].sort().map(([date,count])=>({date,count}))};
 }
 function heatmapDays(activity,end,count=84) {
  if(!validDate(end))return [];const map=new Map(activity.filter(x=>validDate(x.date)).map(x=>[x.date,x.count]));const last=Date.parse(end);
  return Array.from({length:count},(_,i)=>{const date=new Date(last-(count-1-i)*86400000).toISOString().slice(0,10);return {date,count:map.get(date)||0};});
 }
 function filterNotes(notes,{query='',member='all',topic='all',sort='newest'}={}) {
  const q=query.trim().toLocaleLowerCase();return notes.filter(n=>(member==='all'||n.member===member)&&(topic==='all'||(n.tags||[]).includes(topic))&&(!q||[n.title,n.summary,n.member,...(n.tags||[])].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'ko'):String(a.created||'').localeCompare(String(b.created||''))*(sort==='oldest'?1:-1));
 }
 const api={graphForNotes,topicStats,initialTopics,memberStats,heatmapDays,filterNotes,validDate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DDIAModel=api;
})(typeof window!=='undefined'?window:globalThis);
