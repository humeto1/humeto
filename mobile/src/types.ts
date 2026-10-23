export type Task = {
  id: string;
  title: string;
  category?: string;
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
