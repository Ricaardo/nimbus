import { portfolioRefreshModules } from '../src/modules/portfolio-refresh/index.js'
import { agentRunner } from '../src/core/agent.js'
const mod = portfolioRefreshModules[0]!
const ctx: any = {
  trigger: { kind: 'cron', job: 'portfolio:refresh' },
  agent: agentRunner,
  channels: { async send(){return 'x'}, async edit(){}, async sendTyping(){} },
  db: { audit(){}, putSession(){}, getSession(){return null} },
  memory: {}, safety: {},
}
const t0=Date.now(); console.log('触发刷新(agent 带 user → IBKR)…')
await mod.handle(ctx)
console.log(`done in ${((Date.now()-t0)/1000).toFixed(0)}s`); process.exit(0)
