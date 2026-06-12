// One-off: call the real agentRunner exactly like the dispatcher does.
import { agentRunner } from '../src/core/agent.js'
const prompt = process.argv[2] ?? '英伟达现在股价多少、今天涨跌如何?最近24小时一条最重要的新闻是什么?三句话内。'
const t0 = Date.now()
const { sessionId, text } = await agentRunner.run({ prompt })
console.log(`\n--- done in ${((Date.now()-t0)/1000).toFixed(0)}s  session=${sessionId ?? 'none'}`)
console.log('--- reply ---\n' + text)
process.exit(0)
