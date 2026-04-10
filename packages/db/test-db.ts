import postgres from 'postgres';
const sql = postgres('postgresql://openmento_user:openmento_pass@127.0.0.1:5432/openmento_db');
async function test() {
  try {
    const res = await sql`SELECT 1 + 1 AS result`;
    console.log('Connected!', res);
  } catch (e) {
    console.error('Failed', e);
  } finally {
    await sql.end();
  }
}
test();
