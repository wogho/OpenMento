import { db, students } from '@openmento/db';
import { eq } from 'drizzle-orm';
async function run() {
  const all = await db.select().from(students);
  for (let i = 0; i < all.length; i++) {
    await db.update(students).set({ displayName: `Student ${i + 1}` }).where(eq(students.id, all[i].id));
  }
  console.log("Fixed names");
  process.exit(0);
}
run();
