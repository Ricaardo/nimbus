/**
 * hygiene.test.ts — 防回归守卫:确保 skills/ 下文档与脚本不再硬编码 ~/.claude 路径 (2026-07 完全独立清理)。
 *
 * 背景:agent 运行时 CWD=仓库根。SKILL.md/脚本里若写死 `~/.claude/skills/...` 或
 * `/Users/x/.claude/skills/...` 会把 agent 引去错误(且大概率不存在)的路径。已全部改为
 * 仓库相对路径 `skills/<skill>/...`,本测试断言不再出现 `.claude/skills` 这个误用模式。
 *
 * 扫描范围:`skills/**\/SKILL.md` 与 `skills/**\/scripts/**\/*.py|*.sh`。
 *
 * 有意不在扫描范围内的场景(按设计保留,不需要进白名单):
 * - `scripts/sync-skills.sh`(仓库根 scripts/,不在 skills/ 目录下)—— 这是从 ~/.claude/skills
 *   反向同步回项目的运维脚本,`SRC="$HOME/.claude/skills"` 是有意的同步源,非残留硬编码。
 * - `~/.claude/channels/...`(discord token 等运维配置位置)—— 出现在项目根 README/文档而非
 *   skills/ 目录,且模式是 `.claude/channels` 不是 `.claude/skills`,不会被本守卫命中。
 * - `skills/references/api-index.md` 的 `~/.claude/sessions/` —— 描述 Claude Code 自身会话
 *   日志目录,是不同的路径模式(`.claude/sessions`),且该文件不是 SKILL.md,双重排除在扫描外。
 * - `skills/portfolio-manager/README.md` 的 `cp -r portfolio-manager ~/.claude/skills/` ——
 *   面向外部用户"把本 skill 安装进个人 Claude Skills 目录"的说明,是有意的安装目标;该文件是
 *   README.md 不是 SKILL.md,不在扫描范围内。
 * - 各 `scripts/*.py` 里 `_SKILLS = os.path.dirname(...__file__...)  # 自包含,不依赖 ~/.claude`
 *   这类注释 —— 只是否定句(说明"不依赖"),不含 `.claude/skills` 子串,不会被命中。
 *
 * 白名单(WHITELIST,仓库相对路径):目前 1 条 ——
 * - `skills/futuapi/SKILL.md`:文中有一段通用示例,用占位符路径
 *   `/home/user/.claude/skills/futuapi` 说明"脚本默认相对路径找不到时,退回到运行时
 *   系统提示给出的 skill base directory"这一 fallback 机制,属于说明性示例而非本仓库的
 *   真实硬编码(占位符是 `/home/user/`,不是本机用户路径)。语义内容不改,故加入白名单放行。
 */
import { describe, test, expect } from 'bun:test'
import { Glob } from 'bun'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '..')

const WHITELIST: string[] = ['skills/futuapi/SKILL.md']

const FORBIDDEN_PATTERN = /\.claude\/skills/

async function findOffenders(pattern: string): Promise<string[]> {
  const glob = new Glob(pattern)
  const offenders: string[] = []
  for await (const file of glob.scan({ cwd: REPO_ROOT })) {
    if (WHITELIST.includes(file)) continue
    const content = await readFile(path.join(REPO_ROOT, file), 'utf-8')
    if (FORBIDDEN_PATTERN.test(content)) {
      offenders.push(file)
    }
  }
  return offenders
}

describe('skills hygiene: no hardcoded ~/.claude/skills paths', () => {
  test('SKILL.md files use repo-relative paths', async () => {
    const offenders = await findOffenders('skills/**/SKILL.md')
    expect(offenders).toEqual([])
  })

  test('scripts (.py) use repo-relative paths', async () => {
    const offenders = await findOffenders('skills/**/scripts/**/*.py')
    expect(offenders).toEqual([])
  })

  test('scripts (.sh) use repo-relative paths', async () => {
    const offenders = await findOffenders('skills/**/scripts/**/*.sh')
    expect(offenders).toEqual([])
  })
})
