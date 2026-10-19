// ミニゲームカレンダー: ストックから1本、今日の日付に登録する
//
// stock.json に積んである「まだ日付の付いていないゲーム」の先頭を1つ取り出し、
// games.json に「今日の日付」で追加する。
// 1日に何度呼ばれても安全(今日の分がもう入っていれば何もしない)。
//
// 環境変数 DISCORD_WEBHOOK_URL があれば、今日の分の告知文(X・Substackにそのまま貼れる形)を
// Discordに送り、games.json に announced: true を付ける。送れなかったら次の実行でまた試す。

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const GAMES_FILE = path.join(DIR, 'games.json');
const STOCK_FILE = path.join(DIR, 'stock.json');
const LOG_FILE = path.join(DIR, 'promote.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, line);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, '[\n' + data.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n');
}

// 日本時間の今日。GitHub Actions は UTC で動くので、そのままだと 0:10 実行時に前日の日付になる
function todayStr() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 告知文。タイトル末尾の（ステージ制）のような補足は外す
function announceText(game) {
  const [, m, d] = game.date.split('-').map(Number);
  const title = game.title.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
  return `${m}/${d} 今日のミニゲームは・・\n「${title}」\n${game.url || game.file}\n#AIゲーム`;
}

async function announce(game) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) { log('announce: DISCORD_WEBHOOK_URL が無いので告知は送らない'); return false; }
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // flags 4 = リンクのプレビューを出さない(貼り付ける文だけ見えるように)
    body: JSON.stringify({ content: announceText(game), flags: 4, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) { log(`announce: 送信失敗 ${res.status}`); return false; }
  log(`announce: 送信 ${game.date} 「${game.title}」`);
  return true;
}

async function main() {
  const games = readJson(GAMES_FILE, []);
  const stock = readJson(STOCK_FILE, []);
  const today = todayStr();

  let game = games.find(g => g.date === today);
  if (game) {
    log(`skip: ${today} はすでに登録済み(${game.title})`);
  } else if (!stock.length) {
    log('skip: ストックが空。新しいゲームを追加してください');
  } else {
    const next = stock.shift();
    game = { date: today, title: next.title, url: next.url };
    games.push(game);
    writeJson(STOCK_FILE, stock);
    log(`registered: ${today} = 「${next.title}」(残りストック ${stock.length}件)`);
  }

  if (game && !game.announced && await announce(game)) game.announced = true;
  writeJson(GAMES_FILE, games);
}

main();
