"use client";
import { ProductivityDashboard } from "./productivity-dashboard";
import { type Transport } from "./transport";
export function HomeTasks({
  request,
  onOpen,
  tasks,
}: {
  tasks: any[];
  projects: any[];
  goals: any[];
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <ProductivityDashboard
      request={request}
      onOpen={onOpen}
      refreshKey={tasks.map((t) => t.id + ":" + t.revision).join(",")}
      activeTaskIds={tasks.map((t) => t.id)}
    />
  );
}
