import { db, sql } from '@openmento/db';

type ColumnCheck = {
  table: string;
  requiredColumns: string[];
};

const CHECKS: ColumnCheck[] = [
  {
    table: 'agents',
    requiredColumns: ['pause_reason', 'budget_paused_at', 'spent_monthly_cents', 'last_session_params_json', 'last_session_display_id'],
  },
  {
    table: 'heartbeat_runs',
    requiredColumns: ['process_loss_retry_count', 'execution_locked_at', 'context_snapshot', 'session_id_before', 'session_id_after', 'error_code'],
  },
];

async function loadColumns(table: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = ${table}
  `);

  return rows
    .map((row) => {
      const value = (row as Record<string, unknown>).column_name;
      return typeof value === 'string' ? value : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function main() {
  let hasDrift = false;

  for (const check of CHECKS) {
    const columns = await loadColumns(check.table);
    const missing = check.requiredColumns.filter((column) => !columns.includes(column));

    if (missing.length > 0) {
      hasDrift = true;
      console.error(`[db-drift] ${check.table}: missing columns -> ${missing.join(', ')}`);
      continue;
    }

    console.log(`[db-drift] ${check.table}: ok (${check.requiredColumns.join(', ')})`);
  }

  if (hasDrift) {
    process.exitCode = 1;
    return;
  }

  console.log('[db-drift] schema checks passed');
}

void main().catch((error) => {
  console.error('[db-drift] unexpected failure', error);
  process.exitCode = 1;
});