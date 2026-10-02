import { existsSync } from 'node:fs'
import { checkConfig, config } from './config'
import { backupDatabase, integrityOk } from './db/backup'
import { migrate } from './db/migrate'
import { migrations } from './db/migrations'
import { openSqlite } from './db/sqlite'
import { isPlanId } from './billing/plans'

/**
 * Operator commands (run inside the deployment, e.g. `docker compose exec app node dist-server/cli.mjs backup`):
 *   check-config            validate environment variables (exit 1 on errors)
 *   migrate                 apply pending database migrations
 *   backup [dir]            write a consistent online backup (VACUUM INTO)
 *   verify <file>           integrity-check a database/backup file before restoring it
 *   set-plan <businessId> <solo|team|business> [comped|active|trialing]   support override
 */
const [command, ...args] = process.argv.slice(2)
const out = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

switch (command) {
  case 'check-config': {
    const { errors, warnings } = checkConfig(config)
    warnings.forEach((w) => out(`warning: ${w}`))
    errors.forEach((e) => out(`error: ${e}`))
    out(errors.length ? 'configuration has errors' : 'configuration ok')
    process.exit(errors.length ? 1 : 0)
    break
  }
  case 'migrate': {
    const sql = openSqlite(config.databasePath)
    out({ applied: migrate(sql) })
    sql.close()
    break
  }
  case 'backup': {
    const sql = openSqlite(config.databasePath)
    out(backupDatabase(sql, args[0] ?? config.backupDir, config.backupKeep))
    sql.close()
    break
  }
  case 'verify': {
    const file = args[0]
    if (!file || !existsSync(file)) {
      out('usage: verify <database-file>')
      process.exit(2)
    }
    const sql = openSqlite(file)
    const applied = sql.all<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id').map((r) => r.id)
    const report = {
      integrity: integrityOk(sql) ? 'ok' : 'FAILED',
      migrations: `${applied.length}/${migrations.length}`,
      businesses: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM businesses')?.n,
      appointments: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointments')?.n,
      users: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n,
    }
    sql.close()
    out(report)
    process.exit(report.integrity === 'ok' ? 0 : 1)
    break
  }
  case 'set-plan': {
    const [businessId, plan, status = 'comped'] = args
    if (!businessId || !isPlanId(plan) || !['comped', 'active', 'trialing'].includes(status)) {
      out('usage: set-plan <businessId> <solo|team|business> [comped|active|trialing]')
      process.exit(2)
    }
    const sql = openSqlite(config.databasePath)
    const r = sql.run(
      `INSERT INTO subscriptions (business_id, plan, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (business_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, updated_at = excluded.updated_at`,
      [businessId, plan, status, new Date().toISOString()],
    )
    sql.close()
    out({ updated: r.changes })
    break
  }
  default:
    out('commands: check-config | migrate | backup [dir] | verify <file> | set-plan <businessId> <plan> [status]')
    process.exit(command ? 2 : 0)
}
