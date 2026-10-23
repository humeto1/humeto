// Direct task links stay editable independently of the project's goal.
export function taskGoals(
  task: { goals?: { id: string; title: string }[]; project_id?: string },
  projects: { id: string; goal_id?: string }[],
  goals: { id: string; title: string }[],
) {
  const linked = new Map((task.goals || []).map((goal) => [goal.id, goal]));
  const parent = projects.find(
    (project) => project.id === task.project_id,
  )?.goal_id;
  const inherited = goals.find((goal) => goal.id === parent);
  if (inherited) linked.set(inherited.id, inherited);
  return [...linked.values()];
}
