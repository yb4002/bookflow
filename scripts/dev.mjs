// Starts the API server (auto-restarting) and the Vite dev server together.
import { spawn } from 'node:child_process'

const run = (name, cmd, args, env = {}) => {
  const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: false })
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited with code ${code}`)
    process.exit(code ?? 0)
  })
  return child
}

const children = [
  run('api', 'npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts']),
  run('web', 'npx', ['vite', '--host', '0.0.0.0', ...process.argv.slice(2)]),
]
const stop = () => children.forEach((c) => c.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
