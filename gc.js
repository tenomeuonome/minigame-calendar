// GameCenterEG の共通部品。サーバがゲームのHTMLに自動で差し込む。
//   - 開かれたらアクセス数を1つ数える
//   - ゲーム側から GC.submitScore(点数) を呼ぶと、名前を入れてランキングに登録する画面を出す
//   - GC.showRanking() でランキングだけ見せる
// 画面はシャドウDOMの中に作るので、ゲーム側の見た目とはぶつからない。
(() => {
  if (window.GC) return;
  const me = document.currentScript;
  const GAME = me?.dataset.game || '';
  const NAME_KEY = 'gc-name';

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (GAME) post('/api/hit', { game: GAME }).catch(() => {});

  let info = null; // {title, score:{label, unit, order, decimals}}
  const getInfo = async (fresh) => {
    if (info && !fresh) return info;
    try { const r = await fetch('/api/ranking?game=' + encodeURIComponent(GAME)); if (r.ok) info = await r.json(); } catch (e) {}
    return info;
  };
  const fmt = (v, sc) => {
    const d = sc?.decimals ?? (Number.isInteger(v) ? 0 : 2);
    return Number(v).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }) + (sc?.unit ?? '点');
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loadName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  const saveName = n => { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} };

  // お気に入り(☆)と最終プレイ日時はこの端末のlocalStorageだけで管理(アカウント不要)
  const FAV_KEY = 'gc-favorites', LAST_KEY = 'gc-lastplayed';
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } };
  const saveFavs = arr => { try { localStorage.setItem(FAV_KEY, JSON.stringify(arr)); } catch (e) {} };
  const isFavorite = game => loadFavs().includes(game);
  const touchLastPlayed = game => {
    try {
      const m = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
      m[game] = Date.now();
      localStorage.setItem(LAST_KEY, JSON.stringify(m));
    } catch (e) {}
  };
  if (GAME) touchLastPlayed(GAME);

  let host, root;
  function open(html) {
    close();
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}
      .bg{position:fixed;inset:0;background:rgba(10,10,20,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;
        font-family:"Hiragino Sans","Yu Gothic",system-ui,sans-serif;color:#1d1d2b;-webkit-text-size-adjust:100%}
      .card{background:#fff;border-radius:16px;width:100%;max-width:340px;max-height:100%;overflow:auto;padding:18px 18px 16px;box-sizing:border-box;
        box-shadow:0 10px 40px rgba(0,0,0,.35)}
      .brand{font-size:11px;letter-spacing:.12em;color:#7a6ff0;font-weight:700}
      h2{margin:4px 0 2px;font-size:18px}
      .big{font-size:34px;font-weight:800;margin:6px 0 10px;color:#e2442f;font-variant-numeric:tabular-nums}
      label{display:block;font-size:12px;color:#666;margin-bottom:4px}
      input,textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:2px solid #d5d3ea;border-radius:10px;outline:none;resize:vertical}
      input:focus,textarea:focus{border-color:#7a6ff0}
      .clist{margin:8px 0 0;max-height:240px;overflow:auto}
      .citem{padding:8px 4px;border-bottom:1px solid #eee;font-size:14px}
      .citem .cn{font-weight:700;font-size:13px}
      .citem .ct{color:#999;font-weight:400;font-size:11px;margin-left:4px}
      .citem .cb{white-space:pre-wrap;margin-top:2px}
      .row{display:flex;gap:8px;margin-top:12px}
      button,a.btn{flex:1;font:inherit;font-size:15px;font-weight:700;border:0;border-radius:999px;padding:11px 10px;cursor:pointer;text-align:center;text-decoration:none}
      .pri{background:#7a6ff0;color:#fff}.sec{background:#eeedf7;color:#1d1d2b}
      button:disabled{opacity:.5}
      .err{color:#e2442f;font-size:12px;margin-top:6px;min-height:1em}
      ol{list-style:none;margin:8px 0 0;padding:0;font-size:14px}
      li{display:flex;gap:8px;padding:6px 4px;border-bottom:1px solid #eee;font-variant-numeric:tabular-nums}
      li .r{width:2.2em;font-weight:800;color:#7a6ff0}
      li .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      li.me{background:#fff4d6;border-radius:8px}
      .msg{font-size:14px;margin:6px 0 0}
      .empty{color:#888;font-size:13px;padding:10px 0}
    </style><div class="bg"><div class="card">${html}</div></div>`;
    document.body.appendChild(host);
    return root;
  }
  function close() { host?.remove(); host = root = null; }

  // プレイ中もずっと見える「トップへ」ボタン(+お気に入りの☆)
  const homeHost = document.createElement('div');
  homeHost.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483000;display:flex;gap:6px';
  const homeRoot = homeHost.attachShadow({ mode: 'open' });
  homeRoot.innerHTML = `<style>
    .b{display:flex;align-items:center;gap:4px;font:700 13px "Hiragino Sans","Yu Gothic",system-ui,sans-serif;
      background:rgba(20,20,30,.72);color:#fff;text-decoration:none;border:0;border-radius:999px;padding:8px 14px;
      box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:pointer}
    .b:active{background:rgba(20,20,30,.9)}
    .star.on{background:rgba(255,196,0,.9);color:#2a2100}
  </style>
  <a class="b" href="/" target="_top">🏠 トップへ</a>
  ${GAME ? '<button type="button" class="b star" id="favBtn"></button><button type="button" class="b" id="cmtBtn">💬 掲示板</button>' : ''}`;
  (document.body || document.documentElement).appendChild(homeHost);

  if (GAME) {
    homeRoot.querySelector('#cmtBtn').onclick = () => showComments(false);
    const favBtn = homeRoot.querySelector('#favBtn');
    const renderFav = () => {
      const on = isFavorite(GAME);
      favBtn.textContent = on ? '★ お気に入り済み' : '☆ お気に入り';
      favBtn.classList.toggle('on', on);
    };
    renderFav();
    favBtn.onclick = () => {
      const favs = loadFavs();
      const wasOn = favs.includes(GAME);
      saveFavs(wasOn ? favs.filter(s => s !== GAME) : [...favs, GAME]);
      renderFav();
      if (!wasOn) showComments(true); // 新しくお気に入りにしたときは感想の入力を開く
    };
  }

  function listHtml(list, sc, myName) {
    if (!list.length) return '<div class="empty">まだだれも登録していないよ</div>';
    return '<ol>' + list.map(r => `<li class="${r.name === myName ? 'me' : ''}"><span class="r">${r.rank}位</span><span class="n">${esc(r.name)}</span><span>${fmt(r.score, sc)}</span></li>`).join('') + '</ol>';
  }
  const footer = `<div class="row"><button class="sec" data-close>閉じる</button><a class="btn pri" href="/" target="_top">🏠 トップページに戻る</a></div>`;

  async function submitScore(score) {
    if (!GAME) return;
    const inf = await getInfo();
    if (!inf) return; // ランキングの無いゲーム
    const sc = inf.score;
    const r = open(`<div class="brand">ゲームセンターＥＧ</div><h2>${esc(inf.title.replace(/[（(].*$/, ''))}</h2>
      <div class="big">${fmt(score, sc)}</div>
      <label>ランキングに名前をのせる(12文字まで)</label>
      <input maxlength="12" placeholder="なまえ" value="${esc(loadName())}">
      <div class="err"></div>
      <div class="row"><button class="sec" data-close>のせない</button><button class="pri" data-send>登録する</button></div>
      <div style="text-align:center;margin-top:10px"><a href="/" target="_top" style="font-size:12px;color:#7a6ff0;text-decoration:none">🏠 トップページに戻る</a></div>`);
    const input = r.querySelector('input'), err = r.querySelector('.err'), btn = r.querySelector('[data-send]');
    r.querySelector('[data-close]').onclick = close;
    const sendIt = async () => {
      const name = input.value.trim();
      if (!name) { err.textContent = '名前を入れてね'; return; }
      btn.disabled = true; err.textContent = '';
      try {
        const res = await post('/api/score', { game: GAME, name, score });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.error || '登録できなかった'; btn.disabled = false; return; }
        saveName(name);
        const r2 = open(`<div class="brand">ゲームセンターＥＧ</div><h2>ランキング</h2>
          <p class="msg">${esc(name)} さんの自己ベストは <b>${fmt(data.best, sc)}</b>、${data.total}人中 <b>${data.rank}位</b></p>
          ${listHtml(data.ranking, sc, name)}${footer}`);
        r2.querySelector('[data-close]').onclick = close;
      } catch (e) { err.textContent = 'つながらなかった。もう一度押してね'; btn.disabled = false; }
    };
    btn.onclick = sendIt;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendIt(); e.stopPropagation(); });
    input.addEventListener('keyup', e => e.stopPropagation());
  }

  async function showRanking() {
    const inf = await getInfo(true);
    if (!inf) return;
    const r = open(`<div class="brand">ゲームセンターＥＧ</div><h2>${esc(inf.title.replace(/[（(].*$/, ''))} ランキング</h2>
      ${listHtml(inf.ranking.slice(0, 20), inf.score, loadName())}${footer}`);
    r.querySelector('[data-close]').onclick = close;
  }

  function timeAgo(at) {
    const sec = Math.floor((Date.now() - at) / 1000);
    if (sec < 60) return 'たった今';
    if (sec < 3600) return Math.floor(sec / 60) + '分前';
    if (sec < 86400) return Math.floor(sec / 3600) + '時間前';
    return Math.floor(sec / 86400) + '日前';
  }
  function commentListHtml(list) {
    if (!list.length) return '<div class="empty">まだ感想が無いよ。最初の1件を書いてみる?</div>';
    return '<div class="clist">' + list.map(c =>
      `<div class="citem"><div class="cn">${esc(c.name)}<span class="ct">${timeAgo(c.at)}</span></div><div class="cb">${esc(c.text)}</div></div>`
    ).join('') + '</div>';
  }

  async function showComments(focusInput) {
    if (!GAME) return;
    let data = null;
    try { const r = await fetch('/api/comments?game=' + encodeURIComponent(GAME)); if (r.ok) data = await r.json(); } catch (e) {}
    const list = data?.comments || [];
    const title = data?.title ? data.title.replace(/[（(].*$/, '') : '';
    const r = open(`<div class="brand">ゲームセンターＥＧ</div><h2>${esc(title)} 掲示板</h2>
      ${commentListHtml(list)}
      <label style="margin-top:10px">感想・ここが難しい、など(200文字まで)</label>
      <input maxlength="12" placeholder="なまえ" value="${esc(loadName())}" id="cName">
      <textarea id="cText" maxlength="200" rows="3" style="margin-top:6px"></textarea>
      <div class="err"></div>
      <div class="row"><button class="sec" data-close>閉じる</button><button class="pri" data-post>投稿する</button></div>
      <div style="text-align:center;margin-top:10px"><a href="/" target="_top" style="font-size:12px;color:#7a6ff0;text-decoration:none">🏠 トップページに戻る</a></div>`);
    r.querySelector('[data-close]').onclick = close;
    const nameInput = r.querySelector('#cName'), textInput = r.querySelector('#cText'),
      err = r.querySelector('.err'), postBtn = r.querySelector('[data-post]');
    if (focusInput) setTimeout(() => textInput.focus(), 50);
    const postIt = async () => {
      const name = nameInput.value.trim(), text = textInput.value.trim();
      if (!name) { err.textContent = '名前を入れてね'; return; }
      if (!text) { err.textContent = '感想を書いてね'; return; }
      postBtn.disabled = true; err.textContent = '';
      try {
        const res = await post('/api/comment', { game: GAME, name, text });
        const resData = await res.json();
        if (!res.ok) { err.textContent = resData.error || '投稿できなかった'; postBtn.disabled = false; return; }
        saveName(name);
        showComments(false);
      } catch (e) { err.textContent = 'つながらなかった。もう一度押してね'; postBtn.disabled = false; }
    };
    postBtn.onclick = postIt;
    [nameInput, textInput].forEach(el => { el.addEventListener('keydown', e => e.stopPropagation()); el.addEventListener('keyup', e => e.stopPropagation()); });
  }

  window.GC = { game: GAME, submitScore, showRanking, showComments, isFavorite, close };
})();
