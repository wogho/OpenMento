import { pgTable, uuid, timestamp, index, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { instructorSkills } from './instructor_skills.js';

export const studentSkills = pgTable('student_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id')
    .notNull()
    .references(() => instructorSkills.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('student_skills_student_id_idx').on(table.studentId),
  index('student_skills_skill_id_idx').on(table.skillId),
]);

export const studentSkillsRelations = relations(studentSkills, ({ one }) => ({
  student: one(students, {
    fields: [studentSkills.studentId],
    references: [students.id],
  }),
  skill: one(instructorSkills, {
    fields: [studentSkills.skillId],
    references: [instructorSkills.id],
  }),
}));

export type StudentSkill = typeof studentSkills.$inferSelect;
export type NewStudentSkill = typeof studentSkills.$inferInsert;
