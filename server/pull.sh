#!/bin/sh
# VPS側: GitHubの最新を取り込む(cronで2分ごと)。サーバのコードが変わったときだけ再起動する
cd /opt/gamecenter/app || exit 1
git fetch -q origin main || exit 1
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
CHANGED=$(git diff --name-only HEAD origin/main)
git reset -q --hard origin/main
echo "$(date '+%F %T') updated to $(git rev-parse --short HEAD)"
if echo "$CHANGED" | grep -q '^server/'; then
  sudo systemctl restart gamecenter && echo "$(date '+%F %T') restarted"
fi
