import { z } from "zod";
export const stages = [
  "To do",
  "In progress",
  "Waiting",
  "Review",
  "Done",
] as const;
export const intentSchema = z.object({
  kind: z.enum(["create", "update", "list", "help"]),
  title: z.string().max(200).nullable(),
  project: z.string().max(160).nullable(),
  target: z.string().max(200).nullable(),
  stage: z.string().max(100).nullable(),
  important: z.boolean().nullable(),
  urgent: z.boolean().nullable(),
  dueDate: z.string().max(100).nullable(),
  reminder: z.string().max(100).nullable(),
  filter: z.enum([
    "pending",
    "important",
    "urgent",
    "overdue",
    "today",
    "tomorrow",
    "all",
  ]),
  scope: z.enum(["mine", "team"]),
});
export type Intent = z.infer<typeof intentSchema>;
export type TaskSummary = {
  id: string;
  title: string;
  stage: string;
  important: number;
  urgent: number;
  due_date: string;
  assignee: string;
  revision: number;
};
export type ActionPayload = {
  stageTitle?: string;
  projectId?: string;
  projectTitle?: string;
  createProject?: boolean;
  kind: "create" | "update";
  title: string;
  taskId: string | null;
  revision: number | null;
  stage: string;
  important: boolean;
  urgent: boolean;
  dueDate: string;
  reminderAt: string | null;
  timezone: string;
  assignee: string;
  reminderOnly: boolean;
};
export type ActionCard = {
  id: string;
  status: string;
  payload: ActionPayload;
  taskId: string | null;
  expiresAt: number;
};
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  result: {
    total?: number;
    tasks?: TaskSummary[];
    scope?: string;
    action?: ActionCard;
    engine?: string;
  };
};
export type AgentThread = { id: string; title: string; updated_at: string };
export type Reminder = {
  id: string;
  task_id: string;
  title: string;
  remind_at: string;
  timezone: string;
  due: boolean;
};
export type AgentState = {
  threads: AgentThread[];
  threadId: string | null;
  messages: AgentMessage[];
  reminders: Reminder[];
  counts: {
    important: number;
    urgent: number;
    pending: number;
    quadrants: number[];
  };
  engine: string;
  modelConfigured: boolean;
};
