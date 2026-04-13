import jwt from 'jsonwebtoken';
import postgres from 'postgres';
const sql = postgres('postgresql://openmento_user:openmento_pass@127.0.0.1:5432/openmento_db');
async function test() {
  const users = await sql`SELECT * FROM institutions LIMIT 1`;
  const institutionId = users[0].id;
  const token = jwt.sign({ 
    userId: 'admin-id', 
    role: 'admin', 
    institutionId: institutionId 
  }, 'supersecret');
  console.log('TOKEN=' + token);
  await sql.end();
}
test();
