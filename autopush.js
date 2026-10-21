// GameCenterEG: 変更があれば自動で commit & push する見張り役(PCのタスクスケジューラから10分ごと)
//
// Discord のももちはコマンドを実行できないので、ゲームのHTMLや games.json を書き換えるだけにしておき、
// ここで拾って GitHub へ送る。VPS は数分おきに GitHub から取り込むので、そのままサイトに出る。
//
// ついでに games.json の「日付なし」のゲームに公開日を割り当てる
// (いちばん後ろの公開日の翌日から1日1本。今日より前にはしない)。
// stock.json に残っている日付なしのゲームも games.json へ移す。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const GAMES_FILE = path.join(DIR, 'games.json');
const STOCK_FILE = path.join(DIR, 'stock.json');
const LOG_FILE = path.join(DIR, 'autopush.log');

function log(msg) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}
const git = (...args) => execFileSync('git', args, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const nextDay = ds => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function writeGames(list) {
  fs.writeFileSync(GAMES_FILE, '[\n' + list.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n');
}

// 日付の割り当て。games.json が壊れていたら何もしない(壊れたまま送らない)
function assignDates() {
  let games;
  try { games = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); }
  catch (e) { log(`games.json が読めないので今回は送らない: ${e.message}`); return false; }

  let stock = [];
  try { stock = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8')); } catch (e) {}
  const moved = stock.filter(s => s && (s.file || s.url));
  if (moved.length) {
    games.push(...moved.map(s => ({ ...(s.date ? { date: s.date } : {}), title: s.title, ...(s.file ? { file: s.file } : { url: s.url }) })));
    fs.writeFileSync(STOCK_FILE, '[]\n');
    log(`stock.json から ${moved.length} 本を games.json へ移した`);
  }

  const undated = games.filter(g => !g.date);
  if (!undated.length && !moved.length) return true;
  // いちばん後ろの公開日の翌日から。ただし今日より前には置かない
  const last = games.filter(g => g.date).map(g => g.date).sort().pop() || '';
  const today = jstToday();
  const used = new Set(games.filter(g => g.date).map(g => g.date));
  let d = last && nextDay(last) > today ? nextDay(last) : today;
  for (const g of undated) {
    while (used.has(d)) d = nextDay(d);
    g.date = d; used.add(d);
    log(`公開日を割り当て: ${d} ${g.title}`);
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  // 日付を先頭にそろえて書き戻す
  writeGames(games.map(({ date, ...rest }) => ({ date, ...rest })));
  return true;
}

function main() {
  if (!assignDates()) return;
  // 先頭の空白も意味を持つ(" M file")ので、git() の trim を通さずに読む
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: DIR, encoding: 'utf8' }).replace(/\s+$/, '');
  if (!status) return; // 変更なし
  const files = status.split('\n').map(l => l.slice(3)).filter(Boolean);
  git('add', '-A');
  const added = files.filter(f => f.startsWith('games/')).map(f => path.basename(f, '.html'));
  const msg = added.length ? `auto: ゲーム更新 ${added.slice(0, 5).join(', ')}${added.length > 5 ? ' ほか' : ''}` : `auto: ${files.slice(0, 3).join(', ')}`;
  git('commit', '-q', '-m', msg);
  try {
    git('pull', '-q', '--rebase');
    git('push', '-q');
    log(`pushed: ${msg}`);
  } catch (e) {
    log(`push失敗(次の回にまた試す): ${String(e.stderr || e.message).trim().split('\n').slice(-2).join(' / ')}`);
  }
}

try { main(); } catch (e) { log(`エラー: ${String(e.stderr || e.message).trim()}`); }
