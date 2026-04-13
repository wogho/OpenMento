/**
 * drizzle-zod 자동 생성 스키마
 *
 * createInsertSchema : INSERT 검증용 (id·createdAt 등 DB 자동 생성 필드 선택적)
 * createSelectSchema : SELECT 응답 직렬화용 (전체 컬럼 필수)
 *
 * Phase 0-4 이후 각 라우터에서 z.parse() / z.safeParse()로 바로 사용합니다.
 */
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

// ── 신규 도메인 ─────────────────────────────────────────────
export { institutions } from '../schema/institutions.js';
import { institutions } from '../schema/institutions.js';
export const insertInstitutionSchema = createInsertSchema(institutions);
export const selectInstitutionSchema = createSelectSchema(institutions);

import { courses } from '../schema/courses.js';
export const insertCourseSchema = createInsertSchema(courses);
export const selectCourseSchema = createSelectSchema(courses);

import { students } from '../schema/students.js';
export const insertStudentSchema = createInsertSchema(students);
export const selectStudentSchema = createSelectSchema(students);

import { attendanceLogs } from '../schema/attendance_logs.js';
export const insertAttendanceLogSchema = createInsertSchema(attendanceLogs);
export const selectAttendanceLogSchema = createSelectSchema(attendanceLogs);

import { assignmentSubmissions } from '../schema/assignment_submissions.js';
export const insertAssignmentSubmissionSchema = createInsertSchema(assignmentSubmissions);
export const selectAssignmentSubmissionSchema = createSelectSchema(assignmentSubmissions);

import { ewsRiskScores } from '../schema/ews_risk_scores.js';
export const insertEwsRiskScoreSchema = createInsertSchema(ewsRiskScores);
export const selectEwsRiskScoreSchema = createSelectSchema(ewsRiskScores);

import { ragDocuments } from '../schema/rag_documents.js';
export const insertRagDocumentSchema = createInsertSchema(ragDocuments);
export const selectRagDocumentSchema = createSelectSchema(ragDocuments);

import { portfolioProjects } from '../schema/portfolio_projects.js';
export const insertPortfolioProjectSchema = createInsertSchema(portfolioProjects);
export const selectPortfolioProjectSchema = createSelectSchema(portfolioProjects);

import { portfolioSimilarityLogs } from '../schema/portfolio_similarity_logs.js';
export const insertPortfolioSimilarityLogSchema = createInsertSchema(portfolioSimilarityLogs);
export const selectPortfolioSimilarityLogSchema = createSelectSchema(portfolioSimilarityLogs);

import { auditLogs } from '../schema/audit_logs.js';
export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const selectAuditLogSchema = createSelectSchema(auditLogs);

// ── paperclip 차용 ──────────────────────────────────────────
import { agents } from '../schema/agents.js';
export const insertAgentSchema = createInsertSchema(agents);
export const selectAgentSchema = createSelectSchema(agents);

import { heartbeatRuns } from '../schema/heartbeat_runs.js';
export const insertHeartbeatRunSchema = createInsertSchema(heartbeatRuns);
export const selectHeartbeatRunSchema = createSelectSchema(heartbeatRuns);

import { routines, routineTriggers } from '../schema/routines.js';
export const insertRoutineSchema = createInsertSchema(routines);
export const selectRoutineSchema = createSelectSchema(routines);
export const insertRoutineTriggerSchema = createInsertSchema(routineTriggers);
export const selectRoutineTriggerSchema = createSelectSchema(routineTriggers);

import { instructorSkills } from '../schema/instructor_skills.js';
export const insertInstructorSkillSchema = createInsertSchema(instructorSkills);
export const selectInstructorSkillSchema = createSelectSchema(instructorSkills);

import { goals } from '../schema/goals.js';
export const insertGoalSchema = createInsertSchema(goals);
export const selectGoalSchema = createSelectSchema(goals);

import { budgetPolicies, costEvents } from '../schema/budget_policies.js';
export const insertBudgetPolicySchema = createInsertSchema(budgetPolicies);
export const selectBudgetPolicySchema = createSelectSchema(budgetPolicies);
export const insertCostEventSchema = createInsertSchema(costEvents);
export const selectCostEventSchema = createSelectSchema(costEvents);
