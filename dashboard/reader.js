/* Markdown is sanitized; uploaded HTML is explicitly trusted executable publication. */
(function (root) {
 'use strict';
 function safeURL(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
 }
 function resolveURL(value, note, notes, page) {
  if (!value || value.startsWith('#')) return value || '';
  const absolute = safeURL(value, new URL(note.asset_base || './', page).href);
  if (!absolute) return '';
  const u = new URL(absolute), hash = u.hash; u.hash = '';
  const target = notes.find(n => {
   const source = safeURL(n.source_url, page);
   if (source && new URL(source).href.split('#')[0] === u.href) return true;
   // The public GitHub source gives the original filename; asset_base gives its copied directory.
   if (!source || !n.asset_base) return false;
   const filename = new URL(source).pathname.split('/').pop();
   return safeURL(filename, new URL(n.asset_base, page).href) === u.href;
  });
  return target ? new URL(`./reader.html?note=${encodeURIComponent(target.id)}${hash}`, page).href : absolute;
 }
 function findNote(data, search) {
  if (!Array.isArray(data.notes)) throw new Error('노트 데이터 형식 오류');
  const id = new URLSearchParams(search).get('note');
  return data.notes.find(n => n.id === id) || null;
 }
 const blockedTags = ['script','iframe','frame','frameset','object','embed','applet','form','input','button','select','textarea','base','meta','audio','video','source'];
 function clean(content) {
  if (!root.DOMPurify) throw new Error('안전한 렌더링 모듈을 불러오지 못했습니다.');
  return root.DOMPurify.sanitize(content, {
   USE_PROFILES: {html:true},
   FORBID_TAGS: [...blockedTags,'style','link'],
   FORBID_ATTR: ['style','srcset','ping','target','download','action','formaction','srcdoc','autofocus','is'],
   ALLOW_DATA_ATTR: false
  });
 }
 function rewrite(doc, note, notes, page) {
  doc.querySelectorAll('[href], [src], [background]').forEach(node => {
   ['href','src','background'].forEach(attr => {
    if (!node.hasAttribute(attr)) return;
    const raw = node.getAttribute(attr);
    const resolved = resolveURL(raw, note, attr === 'href' ? notes : [], page);
    if (!resolved) node.removeAttribute(attr);
    else node.setAttribute(attr, resolved);
   });
  });
  doc.querySelectorAll('a[href]').forEach(a => {
   a.rel = 'noopener noreferrer';
   if (!a.getAttribute('href').startsWith('#') && new URL(a.href, page).origin !== new URL(page).origin) a.target = '_blank';
  });
  doc.querySelectorAll('img').forEach(img => {img.loading='lazy';img.referrerPolicy='no-referrer';});
 }
 function markdown(note, notes, page = root.location.href) {
  if (!root.marked) throw new Error('Markdown 모듈을 불러오지 못했습니다.');
  const template = root.document.createElement('template');
  template.innerHTML = clean(root.marked.parse(note.content, {gfm:true, breaks:false}));
  rewrite(template.content, note, notes, page);
  const used = new Map();
  template.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
   const slug = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-') || 'section';
   const count = used.get(slug) || 0; used.set(slug,count+1); h.id = count ? `${slug}-${count}` : slug;
  });
  template.content.querySelectorAll('table').forEach(table => {
   const wrap=root.document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','표 · 가로로 스크롤');table.replaceWith(wrap);wrap.append(table);
  });
  template.content.querySelectorAll('pre').forEach(pre => {pre.tabIndex=0;});
  return template.content;
 }
 function originalHTMLURL(note, page = root.location.href) {
  const path=note.path;
  if (typeof path !== 'string' || /[\\\x00-\x1f\x7f]/.test(path) || /%(?:25)*(?:2e|2f|5c)/i.test(path)) throw new Error('HTML 원본 경로 오류');
  const segments=path.split('/');
  if (segments.length < 3 || segments[0] !== 'members' || segments.some(s=>!s || s==='.' || s==='..')) throw new Error('HTML 원본 경로 오류');
  const boundary=new URL('./content/members/',page);
  const url=new URL('./content/'+segments.map(encodeURIComponent).join('/'),page);
  if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(page).origin || !url.pathname.startsWith(boundary.pathname)) throw new Error('HTML 원본 경로 오류');
  return url.href;
 }
 async function init() {
  const $=s=>root.document.querySelector(s), status=$('#reader-status');
  try {
   const res=await root.fetch('./data.json',{cache:'no-store'});
   if (!res.ok) throw new Error(`HTTP ${res.status}`);
   const data=await res.json(), note=findNote(data,root.location.search);
   if (!note) {status.textContent='노트를 찾을 수 없습니다. 주소를 확인하거나 대시보드에서 다시 선택해 주세요.';status.setAttribute('role','alert');return;}
   if (!['markdown','html'].includes(note.format) || (note.format === 'markdown' && typeof note.content !== 'string')) throw new Error('노트 본문이 없습니다. 색인을 다시 생성해 주세요.');
   root.document.title=`${note.title} · DDIA Reading Room`;
   $('#note-title').textContent=note.title || '제목 없는 노트';
   $('#note-author').textContent=note.member || '작성자 미기재';
   $('#note-date').textContent=note.created || '날짜 미기재';
   $('#note-state').textContent=note.status === 'completed' ? '정리 완료' : '작성 중';
   const member=(data.members || []).find(m=>m.id===note.member);
   const avatar=$('#note-avatar');avatar.onerror=()=>{avatar.hidden=true;};avatar.src=safeURL(member?.avatar || `https://github.com/${encodeURIComponent(note.member || '')}.png?size=160`,root.location.href);
   $('#note-tags').replaceChildren(...(note.tags || []).map(tag=>{const span=root.document.createElement('span');span.textContent=`#${tag}`;return span;}));
   const source=safeURL(note.source_url,root.location.href);if(source){$('#note-source').href=source;$('#note-source').hidden=false;}
   const body=$('#note-body');
   if (note.format === 'html') {
    // Uploaded HTML is trusted executable publication, with full same-origin DOM/storage access.
    // Load the exported original directly: never sanitize or rewrite its authored UI/assets.
    const url=originalHTMLURL(note), frame=root.document.createElement('iframe');
    frame.title=`${note.title} · 원본 HTML`;frame.src=url;body.replaceChildren(frame);
    $('#html-notice').hidden=false;$('#html-toolbar').hidden=false;
    $('#html-open').href=url;
   } else body.replaceChildren(markdown(note,data.notes));
   status.hidden=true;$('#note-article').hidden=false;
   if(root.location.hash){let id;try{id=decodeURIComponent(root.location.hash.slice(1));}catch{id='';}root.document.getElementById(id)?.scrollIntoView();}
  } catch(error) {status.textContent=`노트를 불러오지 못했습니다. ${error.message}`;status.setAttribute('role','alert');$('#retry').hidden=false;}
 }
 const api={safeURL,resolveURL,findNote,markdown,originalHTMLURL,init};
 if(typeof module==='object' && module.exports) module.exports=api;
 else {root.DDIAReader=api;if(root.document.querySelector('[data-note-reader]')) init();}
})(typeof window==='object' ? window : globalThis);
