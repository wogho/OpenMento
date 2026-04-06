ALTER TABLE "agents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portfolio_projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instructor_skills" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agents_institution_id_idx" ON "agents" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "agents_reports_to_idx" ON "agents" USING btree ("reports_to");--> statement-breakpoint
CREATE INDEX "agents_deleted_at_idx" ON "agents" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "assignment_submissions_student_id_idx" ON "assignment_submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "assignment_submissions_course_id_idx" ON "assignment_submissions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assignment_submissions_deleted_at_idx" ON "assignment_submissions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "attendance_logs_student_id_idx" ON "attendance_logs" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "attendance_logs_course_id_idx" ON "attendance_logs" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "attendance_logs_attendance_date_idx" ON "attendance_logs" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "attendance_logs_deleted_at_idx" ON "attendance_logs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "audit_logs_institution_id_idx" ON "audit_logs" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "budget_policies_institution_id_idx" ON "budget_policies" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "budget_policies_agent_id_idx" ON "budget_policies" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "cost_events_institution_id_idx" ON "cost_events" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "cost_events_agent_id_idx" ON "cost_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "cost_events_created_at_idx" ON "cost_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "courses_institution_id_idx" ON "courses" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "courses_deleted_at_idx" ON "courses" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "ews_risk_scores_student_id_idx" ON "ews_risk_scores" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "ews_risk_scores_course_id_idx" ON "ews_risk_scores" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "ews_risk_scores_calculated_at_idx" ON "ews_risk_scores" USING btree ("calculated_at");--> statement-breakpoint
CREATE INDEX "goals_institution_id_idx" ON "goals" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "goals_initiator_agent_id_idx" ON "goals" USING btree ("initiator_agent_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_institution_id_idx" ON "heartbeat_runs" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_agent_id_idx" ON "heartbeat_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_created_at_idx" ON "heartbeat_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "students_institution_id_idx" ON "students" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "students_course_id_idx" ON "students" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "students_deleted_at_idx" ON "students" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "rag_documents_embedding_hnsw_idx" ON "rag_documents" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "rag_documents_institution_id_idx" ON "rag_documents" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "rag_documents_course_id_idx" ON "rag_documents" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "rag_documents_deleted_at_idx" ON "rag_documents" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "portfolio_projects_embedding_hnsw_idx" ON "portfolio_projects" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "portfolio_projects_student_id_idx" ON "portfolio_projects" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "portfolio_projects_course_id_idx" ON "portfolio_projects" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "portfolio_projects_institution_id_idx" ON "portfolio_projects" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "portfolio_projects_deleted_at_idx" ON "portfolio_projects" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "portfolio_similarity_logs_source_project_id_idx" ON "portfolio_similarity_logs" USING btree ("source_project_id");--> statement-breakpoint
CREATE INDEX "portfolio_similarity_logs_compare_project_id_idx" ON "portfolio_similarity_logs" USING btree ("compare_project_id");--> statement-breakpoint
CREATE INDEX "routine_triggers_routine_id_idx" ON "routine_triggers" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "routines_institution_id_idx" ON "routines" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "routines_agent_id_idx" ON "routines" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "routines_course_id_idx" ON "routines" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "instructor_skills_institution_id_idx" ON "instructor_skills" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "instructor_skills_course_id_idx" ON "instructor_skills" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "instructor_skills_agent_id_idx" ON "instructor_skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "instructor_skills_deleted_at_idx" ON "instructor_skills" USING btree ("deleted_at");