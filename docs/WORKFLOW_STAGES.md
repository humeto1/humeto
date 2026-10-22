# Inline workflow stages

Workspace owners edit Tasks to-do, Leads, Applicants and Applications directly on their boards. Click a stage title to rename it. The column menu supports rename, move left/right and deletion; Add stage opens a short inline form. Saves use the pipeline revision so conflicting edits are rejected. The old separate stage form is no longer shown in Settings.

Deletion asks where existing cards should move, and updates those cards transactionally. Retired keys redirect future writes. Underlying stage identifiers preserve milestone behavior when titles change. Duplicate/empty titles, stale writes, cross-workspace access and read-only subscriptions remain guarded by the server. At most 30 stages are supported per pipeline.

Tasks now use the same stored pipeline configuration as CRM. Custom stages appear in board/list/detail controls and live assistant context. Reviewed assistant proposals for retired stages are rejected; new task defaults and focus writes follow configured redirects.

The task completion column (original key Done) may be renamed/reordered but cannot be deleted, because completion history, reminders and focus timers depend on that role. Creation/focus redirects must lead to an unfinished stage. The four importance/urgency quadrants are separate priority dimensions, not workflow columns.

Migration 021 relaxes the pipeline-kind constraint to include tasks and extends the existing database redirect trigger to task writes. It does not modify existing customer stage names or cards.

Validation: Next.js build and 140 release checks passed. Migration 021 applied to the connected Neon database. Task-only access uses the tasks feature gate; CRM stage writes retain their CRM gate.
