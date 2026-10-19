// ミニゲームカレンダー: ストックから1本、今日の日付に登録する
//
// stock.json に積んである「まだ日付の付いていないゲーム」の先頭を1つ取り出し、
// games.json に「今日の日付」で追加する。
// 1日に何度呼ばれても安全(今日の分がもう入っていれば何もしない)。
// タスクスケジューラから1日1回呼ばれる想定。

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const GAMES_FILE = path.join(DIR, 'games.json');
const STOCK_FILE = path.join(DIR, 'stock.json');
const LOG_FILE = path.join(DIR, 'promote.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

// 日本時間の今日。GitHub Actions は UTC で動くので、そのままだと 0:10 実行時に前日の日付になる
function todayStr() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function main() {
  const games = readJson(GAMES_FILE, []);
  const stock = readJson(STOCK_FILE, []);
  const today = todayStr();

  if (games.some(g => g.date === today)) {
    log(`skip: ${today} はすでに登録済み(${games.find(g => g.date === today).title})`);
    return;
  }

  if (!stock.length) {
    log('skip: ストックが空。新しいゲームを追加してください');
    return;
  }

  const next = stock.shift();
  games.push({ date: today, title: next.title, url: next.url });

  fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2) + '\n');
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2) + '\n');
  log(`registered: ${today} = 「${next.title}」(残りストック ${stock.length}件)`);
}

main();
