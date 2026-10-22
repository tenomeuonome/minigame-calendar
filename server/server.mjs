// GameCenterEG (gamecenter.egoapps.com) のサーバ
//
// - 画面とゲームのHTMLを配る(公開日が来ていないゲームは見せない。?preview=1 なら見られる)
// - ゲームごとのアクセス数を数える      POST /api/hit    {game}
// - スコアを受け取ってランキングを返す   POST /api/score  {game, name, score}
//                                        GET  /api/ranking?game=slug
// - 公開中のゲーム一覧(回数・1位つき)   GET  /api/games
// - 毎朝7:00(日本時間)に、その日のゲームをDiscordへ告知(DISCORD_WEBHOOK_URL があれば)
//
// 追加パッケージは使わない(Node 24 の node:http と node:sqlite だけ)。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8030);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'gamecenter.db');
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://gamecenter.egoapps.com';
const ANNOUNCE_HOUR = 7;
const SALT = process.env.IP_SALT || 'gamecenter-eg';

// ---------- データベース ----------
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS hits (
    id INTEGER PRIMARY KEY, game TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS hits_game ON hits(game, ip, at);
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, score REAL NOT NULL,
    ip TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS scores_game ON scores(game, score);
  CREATE TABLE IF NOT EXISTS announced (date TEXT PRIMARY KEY, game TEXT, at INTEGER);
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
    ip TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS comments_game ON comments(game, at);
`);

// ---------- ゲーム一覧 ----------
let gamesCache = { mtime: 0, list: [] };
function allGames() {
  const file = path.join(ROOT, 'games.json');
  const st = fs.statSync(file);
  if (st.mtimeMs !== gamesCache.mtime) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')).map(g => ({
      ...g,
      slug: g.slug || (g.file ? path.basename(g.file, '.html') : g.date),
    }));
    gamesCache = { mtime: st.mtimeMs, list };
  }
  return gamesCache.list;
}

// 日本時間の今日(YYYY-MM-DD)と今の時
function jstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours() };
}
const isOpen = g => g.date && g.date <= jstNow().date;
const findGame = slug => allGames().find(g => g.slug === slug);

// ---------- 小道具 ----------
function clientIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  return crypto.createHash('sha256').update(SALT + ip).digest('hex').slice(0, 16);
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 4096) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ランキングに出す名前のチェック。人に見える場所なので、ひどい言葉は止める
const NG_WORDS = ['死ね', 'しね', '殺す', 'ころす', 'ちんこ', 'ちんぽ', 'まんこ', 'うんこ', 'セックス', 'せっくす',
  'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'sex', 'porn', 'ガイジ', 'がいじ', 'キチガイ', 'きちがい', 'http', 'www.'];
// カタカナはひらがなにそろえ、記号や空白を抜いてから調べる(シ・ネ のような書き方もはじく)
const kana = s => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
function hasNgWord(text) {
  const flat = kana(text).replace(/[\s._\-・ー~〜!！?？*＊]/g, '');
  return NG_WORDS.some(w => flat.includes(kana(w)));
}
function cleanName(raw) {
  const name = String(raw || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (!name || [...name].length > 12) return null;
  if (hasNgWord(name)) return null;
  return name;
}
function cleanComment(raw) {
  const text = String(raw || '').normalize('NFKC').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, '').trim();
  if (!text || [...text].length > 200) return null;
  if (hasNgWord(text)) return null;
  return text;
}

function ranking(game, limit = 20) {
  const order = game.score?.order === 'asc' ? 'ASC' : 'DESC';
  const best = order === 'ASC' ? 'MIN' : 'MAX';
  // 同じ名前は自己ベストだけを残す
  return db.prepare(`
    SELECT name, ${best}(score) AS score, MIN(at) AS at FROM scores WHERE game = ?
    GROUP BY name ORDER BY score ${order}, at ASC LIMIT ?`).all(game.slug, limit)
    .map((r, i) => ({ rank: i + 1, name: r.name, score: r.score }));
}

// ---------- API ----------
const lastScoreAt = new Map();
const lastCommentAt = new Map();

async function api(req, res, url) {
  const p = url.pathname;

  if (p === '/api/games' && req.method === 'GET') {
    const plays = Object.fromEntries(db.prepare('SELECT game, COUNT(*) AS n FROM hits GROUP BY game').all().map(r => [r.game, r.n]));
    const list = allGames().filter(isOpen).map(g => {
      const top = g.score ? ranking(g, 1)[0] || null : null;
      return { date: g.date, slug: g.slug, title: g.title, href: g.file ? '/' + g.file : g.url,
        plays: plays[g.slug] || 0, score: g.score || null, top };
    });
    return send(res, 200, { today: jstNow().date, games: list });
  }

  if (p === '/api/hit' && req.method === 'POST') {
    const body = await readBody(req);
    const g = findGame(String(body.game || ''));
    if (!g) return send(res, 404, { error: 'no such game' });
    const ip = clientIp(req), now = Date.now();
    // 同じ人が30分以内に開き直したぶんは数えない
    const recent = db.prepare('SELECT 1 FROM hits WHERE game = ? AND ip = ? AND at > ? LIMIT 1').get(g.slug, ip, now - 30 * 60 * 1000);
    if (!recent) db.prepare('INSERT INTO hits (game, ip, at) VALUES (?, ?, ?)').run(g.slug, ip, now);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/score' && req.method === 'POST') {
    const body = await readBody(req);
    const g = findGame(String(body.game || ''));
    if (!g || !g.score) return send(res, 404, { error: 'このゲームはランキングがありません' });
    const name = cleanName(body.name);
    if (!name) return send(res, 400, { error: '名前は12文字までで、使えない言葉が入っていないものにしてね' });
    const score = Number(body.score);
    const max = g.score.max ?? 1e9, min = g.score.min ?? 0;
    if (!Number.isFinite(score) || score < min || score > max) return send(res, 400, { error: 'スコアがおかしいみたい' });
    const ip = clientIp(req), now = Date.now();
    if (now - (lastScoreAt.get(ip) || 0) < 3000) return send(res, 429, { error: 'ちょっと待ってからもう一度' });
    lastScoreAt.set(ip, now);
    db.prepare('INSERT INTO scores (game, name, score, ip, at) VALUES (?, ?, ?, ?, ?)').run(g.slug, name, score, ip, now);
    const list = ranking(g, 1000);
    const mine = list.find(r => r.name === name);
    return send(res, 200, { ok: true, rank: mine?.rank ?? null, best: mine?.score ?? score, total: list.length, ranking: list.slice(0, 10) });
  }

  if (p === '/api/ranking' && req.method === 'GET') {
    const g = findGame(url.searchParams.get('game') || '');
    if (!g || !g.score) return send(res, 404, { error: 'no ranking' });
    return send(res, 200, { game: g.slug, title: g.title, score: g.score, ranking: ranking(g, 50) });
  }

  if (p === '/api/comments' && req.method === 'GET') {
    const g = findGame(url.searchParams.get('game') || '');
    if (!g) return send(res, 404, { error: 'no such game' });
    const list = db.prepare('SELECT name, text, at FROM comments WHERE game = ? ORDER BY at DESC LIMIT 50').all(g.slug);
    return send(res, 200, { game: g.slug, title: g.title, comments: list });
  }

  if (p === '/api/comment' && req.method === 'POST') {
    const body = await readBody(req);
    const g = findGame(String(body.game || ''));
    if (!g) return send(res, 404, { error: 'no such game' });
    const name = cleanName(body.name);
    if (!name) return send(res, 400, { error: '名前は12文字までで、使えない言葉が入っていないものにしてね' });
    const text = cleanComment(body.text);
    if (!text) return send(res, 400, { error: '感想は200文字までで、使えない言葉が入っていないものにしてね' });
    const ip = clientIp(req), now = Date.now();
    if (now - (lastCommentAt.get(ip) || 0) < 3000) return send(res, 429, { error: 'ちょっと待ってからもう一度' });
    lastCommentAt.set(ip, now);
    db.prepare('INSERT INTO comments (game, name, text, ip, at) VALUES (?, ?, ?, ?, ?)').run(g.slug, name, text, ip, now);
    const list = db.prepare('SELECT name, text, at FROM comments WHERE game = ? ORDER BY at DESC LIMIT 50').all(g.slug);
    return send(res, 200, { ok: true, comments: list });
  }

  return send(res, 404, { error: 'not found' });
}

// ---------- 画面・ゲームのファイル ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json; charset=utf-8' };
const PUBLIC_FILES = new Set(['/index.html', '/ranking.html', '/gc.js']);

function serveFile(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const isGame = /^\/games\/[\w\-.]+\.html$/.test(p);
  const isAsset = /^\/(games|assets)\/[\w\-./]+\.(png|jpg|svg|webp|mp3|ogg|css|js)$/.test(p) && !p.includes('..');
  if (!PUBLIC_FILES.has(p) && !isGame && !isAsset) return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');

  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');

  if (isGame) {
    const g = allGames().find(x => x.file === p.slice(1));
    const preview = url.searchParams.get('preview') === '1';
    if (!g || (!isOpen(g) && !preview)) return send(res, 404, 'まだ公開されていないゲームです', 'text/plain; charset=utf-8');
    let html = fs.readFileSync(file, 'utf8');
    // 計測とランキングの部品を差し込む(ゲームのHTMLは手を入れずに済むように)
    if (!html.includes('/gc.js')) {
      const tag = `<script src="/gc.js" data-game="${g.slug}" defer></script>`;
      html = html.includes('</body>') ? html.replace('</body>', tag + '</body>') : html + tag;
    }
    return send(res, 200, html, TYPES['.html']);
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- 毎朝の告知 ----------
function announceText(g) {
  const [, m, d] = g.date.split('-').map(Number);
  const title = g.title.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
  const href = g.file ? `${PUBLIC_URL}/${g.file}` : g.url;
  return `${m}/${d} 今日のミニゲームは・・\n「${title}」\n${href}\n\nゲームセンターＥＧ\n${PUBLIC_URL}/\n#AIゲーム`;
}
let announcing = false;
async function announceTick() {
  if (!WEBHOOK || announcing) return;
  const { date, hour } = jstNow();
  if (hour < ANNOUNCE_HOUR) return;
  if (db.prepare('SELECT 1 FROM announced WHERE date = ?').get(date)) return;
  const g = allGames().find(x => x.date === date);
  if (!g) return;
  announcing = true;
  try {
    const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: announceText(g), flags: 4, allowed_mentions: { parse: [] } }) });
    if (r.ok) {
      db.prepare('INSERT INTO announced (date, game, at) VALUES (?, ?, ?)').run(date, g.slug, Date.now());
      console.log(`announce: ${date} ${g.title}`);
    } else console.error(`announce failed: ${r.status}`);
  } catch (e) { console.error('announce error:', e.message); }
  finally { announcing = false; }
}
setInterval(announceTick, 60 * 1000);
setTimeout(announceTick, 5000);

// ---------- 起動 ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', 'text/plain');
    return serveFile(req, res, url);
  } catch (e) {
    console.error(req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, 400, { error: 'bad request' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`GameCenterEG listening on 127.0.0.1:${PORT}`));
