export type Task = {
  routine_id?: string;
  display_title?: string;
  value_type?: string;
  value_minor?: number | null;
  value_currency?: string;
  value_note?: string;
  id: string;
  title: string;
  category?: string;
  work_kind?: string;
  stage: string;
  important: number;
  urgent: number;
  revision: number;
  due_date: string;
  assignee: string;
  project_id: string;
  project_title: string;
  person_name?: string;
  goals?: { id: string; title: string }[];
};
export type Workstream = {
  revision: number;
  category?: string;
  goal_id?: string;
  success_metric?: string;
  id: string;
  title: string;
  description: string;
  status: string;
  target_date: string;
};
export type Bootstrap = {
  actor: {
    id: string;
    name: string;
    email: string;
    role: string;
    tenantName: string;
  };
  tasks: Task[];
  projects: Workstream[];
  goals: Workstream[];
  members: { id: string; name: string }[];
  stages: { revision: number; stages: { key: string; title: string }[] };
  writable: boolean;
  subscription: { status: string; expires_at: string };
};
