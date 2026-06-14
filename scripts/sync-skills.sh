#!/usr/bin/env bash
# sync-skills.sh — 从 ~/.claude/skills 同步已 fork 的投资 skill 到项目,防漂移。
#
# ⚠️ 解耦后基本废弃(见 docs/decouple-from-cc.md):项目 skills/ 已是唯一真相源,
#    脚本内部路径都改成 __file__ 相对、不再依赖 ~/.claude/skills。删除 ~/.claude/skills
#    后本脚本 SRC 不存在即空跑。仅当你仍在 ~/.claude/skills 编辑、想拉回项目时才用。
#
# 只同步 nimbus/skills 里**已存在**的 skill(不引入非投资 skill)。
# 排除重二进制(node_modules/venv/.git)+ references 的 state/(运行时数据,
# 由刷新作业维护,不该被定义同步覆盖)。
#
# 用法:更新了某个 CC skill 后跑一次 → git add/commit。
set -euo pipefail

SRC="$HOME/.claude/skills"
DST="$HOME/nimbus-stack/nimbus/skills"
synced=0 skipped=0

for d in "$DST"/*/; do
  name="$(basename "$d")"
  if [ ! -d "$SRC/$name" ]; then
    echo "  跳过 $name(源已无)"; skipped=$((skipped+1)); continue
  fi
  # 排除运行时数据(state 实时持仓 / square-bot 队列db / 缓存),只同步定义。
  rsync -a --delete \
    --exclude 'node_modules/' --exclude '.venv/' --exclude 'venv/' \
    --exclude '.git/' --exclude '__pycache__/' --exclude '*.pyc' \
    --exclude 'state/' --exclude 'bot/queue/' --exclude 'bot/data/' \
    --exclude 'posts.db' --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
    "$SRC/$name/" "$d"
  echo "  ✓ $name"
  synced=$((synced+1))
done

echo ""
echo "同步完成:$synced 个,跳过 $skipped 个。"
echo "提交:cd ~/nimbus-stack/nimbus && git add skills && git commit -m 'sync skills from ~/.claude'"
