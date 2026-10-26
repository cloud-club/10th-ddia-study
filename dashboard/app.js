/* DDIA dashboard: render source metadata, never synthetic activity. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s), M=window.DDIAModel;
 const state={data:null,query:'',member:'all',topic:'all',sort:'newest',graph:null};
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function link(text,url,cls='') {const n=el('a',cls,text);try{const u=new URL(url,location.href);if(!url||!/^https?:$/.test(u.protocol))return el('span',cls,text);n.href=url;if(/^https?:/i.test(url)){n.target='_blank';n.rel='noopener noreferrer';}return n;}catch{return el('span',cls,text);}}
 const tags=values=>{const list=el('ul','tags');(values||[]).forEach(t=>list.append(el('li','',`#${t}`)));return list;};
 const date=value=>M.validDate(value)?value:'날짜 미기재';
 function avatarFor(id, url) {
  const box=el('span','avatar',String(id||'?').slice(0,1).toUpperCase());
  const img=el('img');img.alt='';img.width=42;img.height=42;img.loading='lazy';img.referrerPolicy='no-referrer';
  img.onerror=()=>img.remove();img.src=url||`https://github.com/${encodeURIComponent(id)}.png?size=160`;box.append(img);return box;
 }
 function renderFeed() {
  const feed=Array.isArray(state.data.feed)?state.data.feed:state.data.notes.map(n=>({...n,date:n.created}));
  $('#feed').replaceChildren(...feed.slice(0,6).map((f,i)=>{
   const item=el('li',`post${i===0?' is-new':''}`),head=el('header','post__head'),avatar=avatarFor(f.member),who=el('div');
   who.append(el('strong','',f.member),el('small','',`${date(f.date)} / 읽기 노트`));head.append(avatar,who);
   const h=el('h3');h.append(link(f.title,f.url));item.append(head,h);if(f.summary)item.append(el('p','post__quote',f.summary));item.append(tags(f.tags),link('원문 노트 ↗',f.url,'source-link'));return item;
  }));if(!feed.length)$('#feed').append(el('li','empty','아직 중계할 노트가 없습니다.'));
 }
 function renderMembers(){
  const notes=state.data.notes;
  $('#member-grid').replaceChildren(...state.data.members.map(raw=>{
   const m=M.memberStats(raw,notes),own=M.filterNotes(notes,{member:m.id}),card=el('article','card'),head=el('header','card__head'),who=el('div');
   who.append(el('small','eyebrow','READING MEMBER'),el('h3','',m.id));head.append(avatarFor(m.id,m.avatar),who,el('span','level',`Lv. ${m.level}`));card.append(head);
   card.append(el('p','card__summary',`${m.note_count}편의 노트로 읽기의 흔적을 남겼습니다.`));
   const xp=el('div','xp'),meta=el('div','xp__meta');meta.append(el('span','',`${m.xp} XP`),el('span','',`${m.xp_in_level} / 100 → Lv. ${m.level+1}`));const bar=el('div','xp__bar'),fill=el('div','xp__fill');fill.style.width=`${m.xp_in_level}%`;bar.append(fill);xp.append(meta,bar);card.append(xp);
   const counts=el('dl','counts');[[m.note_count,'노트'],['—','커밋 미집계'],[date(m.latest_date),'최근 작성']].forEach(([v,k])=>{const pair=el('div');pair.append(el('dt','',k),el('dd','',String(v)));counts.append(pair);});card.append(counts);
   const heat=el('div','heatmap');heat.setAttribute('role','img');heat.setAttribute('aria-label',`${m.id}의 노트 작성일 기준 최근 12주 활동`);
   const today=new Date().toISOString().slice(0,10),cells=M.heatmapDays(m.activity,today);
   cells.forEach(c=>{const cell=el('i',c.count?`l${Math.min(3,c.count)}`:'');cell.title=`${c.date}: 노트 ${c.count}편`;heat.append(cell);});card.append(heat,el('small','heatmap__caption',m.activity.length?'최근 12주 · 노트 작성일 기준 · 빈 칸은 기록 없음':'작성일이 있는 노트 없음 · 커밋 히트맵이 아닙니다.'));
   card.append(tags([...new Set(own.flatMap(n=>n.tags||[]))]));const list=el('ul','items');own.slice(0,3).forEach(n=>{const item=el('li');item.append(link(n.title,n.url));list.append(item);});card.append(list);
   const button=el('button','graph-button','그래프에서 보기 ↗');button.type='button';button.onclick=()=>{state.member='all';state.topic='all';state.query='';$('#member-filter').value='all';$('#search').value='';renderTopicButtons();renderGraphAndNotes();const node=M.graphForNotes(state.data.notes,state.data.graph).nodes.find(n=>n.type==='member'&&(n.member===m.id||n.label===m.id));if(node)state.graph?.focus(node.id);};card.append(button);return card;
  }));if(!state.data.members.length)$('#member-grid').append(el('p','empty','첫 노트를 작성하면 멤버 카드가 나타납니다.'));
 }
 function renderActivity(){const rows=M.filterNotes(state.data.notes).slice(0,15);$('#activity').replaceChildren(...rows.map(n=>{const row=el('li');row.append(el('time','activity__date',date(n.created)),el('strong','',n.member),link(n.title,n.url));return row;}));if(!rows.length)$('#activity').append(el('li','empty','아직 기록된 노트가 없습니다.'));}
 function renderTopicButtons(){const topics=state.data.topics||[];$('#topic-filters').replaceChildren(...[{tag:'all'},...topics].map(t=>{const b=el('button',`topic-chip${state.topic===t.tag?' is-active':''}`,t.tag==='all'?'전체 주제':`#${t.tag}`);b.type='button';b.setAttribute('aria-pressed',String(state.topic===t.tag));b.onclick=()=>{state.topic=t.tag;renderTopicButtons();renderGraphAndNotes();};return b;}));}
 function renderGraphAndNotes(){
  const notes=M.filterNotes(state.data.notes,state),graph=M.graphForNotes(notes,state.data.graph);
  $('#result-count').textContent=`${notes.length} / ${state.data.notes.length}`;
  $('#note-list').replaceChildren(...notes.map(n=>{const card=el('article','note-card'),h=el('h3');h.append(link(n.title,n.url));card.append(el('small','',`${n.member} / ${date(n.created)} / ${n.status==='completed'?'정리 완료':'작성 중'}`),h,el('p','',n.summary||''),tags(n.tags));return card;}));if(!notes.length)$('#note-list').append(el('p','empty','조건에 맞는 노트가 없습니다. 필터를 초기화해 주세요.'));
  state.graph?.destroy();
  state.graph=window.DDIAGraph?.mount($('#graph-panel'),graph,()=>'#c8233d');
  if(!window.DDIAGraph)$('#knowledge-graph').textContent='그래프 모듈을 불러오지 못했습니다. 새로고침해 주세요.';
  $('#graph-count').textContent=`멤버 ${graph.nodes.filter(n=>n.type==='member').length} · 노트 ${notes.length} · 전체 주제 ${graph.nodes.filter(n=>n.type==='topic').length}`;
 }
 async function init(){
  try{
   const res=await fetch(`./data.json?v=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();if(!Array.isArray(data.notes)||!Array.isArray(data.members))throw new Error('노트 데이터 형식 오류');state.data=data;
   $('#digest').textContent=`${data.members.length}명의 멤버, ${data.notes.length}편의 노트. ${data.topics?.length||0}개의 주제로 서로의 읽기를 잇고 있습니다.`;
   $('#stats').replaceChildren(...[[data.members.length,'멤버'],[data.notes.length,'읽기 노트'],[data.topics?.length||0,'주제']].map(([v,k])=>{const li=el('li');li.append(el('strong','',String(v).padStart(2,'0')),el('span','',k));return li;}));
   data.members.forEach(m=>{const o=el('option','',m.id);o.value=m.id;$('#member-filter').append(o);});
   renderFeed();renderMembers();renderActivity();renderTopicButtons();renderGraphAndNotes();
   $('#build-meta').textContent=`색인 갱신 ${data.generated_at||'날짜 미기재'} · Markdown 노트 기준`;
  }catch(error){$('#load-error').hidden=false;$('#load-error').textContent=`데이터를 불러오지 못했습니다 (${error.message}). data.json을 확인한 뒤 새로고침해 주세요.`;$('#feed').replaceChildren(el('li','empty','노트를 표시할 수 없습니다.'));$('#digest').textContent='현황 데이터를 확인할 수 없습니다.';$('#stats').textContent='통계 확인 불가';$('#build-meta').textContent='데이터 로딩 실패';$('#knowledge-graph').textContent='그래프 데이터를 확인할 수 없습니다.';}
 }
 $('#search').oninput=e=>{state.query=e.target.value;if(state.data)renderGraphAndNotes();};$('#member-filter').onchange=e=>{state.member=e.target.value;if(state.data)renderGraphAndNotes();};$('#sort-filter').onchange=e=>{state.sort=e.target.value;if(state.data)renderGraphAndNotes();};
 $('#clear-filters').onclick=()=>{state.query='';state.member='all';state.topic='all';state.sort='newest';$('#search').value='';$('#member-filter').value='all';$('#sort-filter').value='newest';if(state.data){renderTopicButtons();renderGraphAndNotes();}};$('#clear-focus').onclick=()=>state.graph?.clearFocus();
 init();
})();
