"use client";
import { WorkTotals } from "./work-totals";
import { ProjectWbs } from "./project-wbs";
import { PlanInsights } from "./plan-insights";
import { useState, useId, useEffect } from "react";
import { Network, Settings2, Target } from "lucide-react";
import { PlanTeam } from "./plan-team";
import { PlanFinancial } from "./plan-financial";
import { PlanSuccess } from "./plan-success";
import { ProjectCollaboration } from "./project-collaboration";
import { webApi, type Transport } from "./transport";
import "./plan-tabs.css";
const tabs = [
  { id: "wbs", label: "WBS", icon: Network },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "success", label: "CSFs & KPIs", icon: Target },
] as const;
type Tab = (typeof tabs)[number]["id"];
export function ParentControls({
  type,
  id,
  writable,
  request = webApi,
  shareLink,
  downloadFile,
  onUpdate,
}: {
  type: "project" | "goal";
  id: string;
  writable: boolean;
  request?: Transport;
  shareLink?: (url: string, title: string) => Promise<void>;
  onUpdate?: () => Promise<void>;
  downloadFile?: (path: string, name: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("wbs"),
    [visited, setVisited] = useState<Set<Tab>>(new Set(["wbs"])),
    [collaborating, setCollaborating] = useState(false);
  const uid = useId();
  function select(t: Tab) {
    setTab(t);
    setVisited((old) => new Set([...old, t]));
  }
  return (
    <div className="parent-controls plan-tools">
      <WorkTotals type={type} id={id} request={request} />
      <div
        role="tablist"
        aria-label={`${type === "project" ? "Project" : "Goal"} tools`}
        className="plan-tool-tabs"
        onKeyDown={(e) => {
          const index = tabs.findIndex((t) => t.id === tab);
          const next =
            e.key === "ArrowRight"
              ? (index + 1) % 3
              : e.key === "ArrowLeft"
                ? (index + 2) % 3
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : -1;
          if (next < 0) return;
          e.preventDefault();
          select(tabs[next].id);
          e.currentTarget
            .querySelectorAll<HTMLButtonElement>("[role=tab]")
            [next]?.focus();
        }}
      >
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            id={uid + "-" + t.id}
            aria-controls={uid + "-" + t.id + "-panel"}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
          >
            <t.icon size={17} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          role="tabpanel"
          key={t.id}
          id={uid + "-" + t.id + "-panel"}
          aria-labelledby={uid + "-" + t.id}
          hidden={tab !== t.id}
          tabIndex={0}
          className="plan-tool-panel"
        >
          {visited.has(t.id) &&
            (t.id === "wbs" ? (
              <>
                {type === "project" ? (
                  <ProjectWbs
                    projectId={id}
                    writable={writable}
                    request={request}
                    onUpdate={onUpdate}
                  />
                ) : (
                  <GoalProjectMaps
                    id={id}
                    writable={writable}
                    request={request}
                    onUpdate={onUpdate}
                  />
                )}
              </>
            ) : t.id === "settings" ? (
              <section
                className="plan-settings"
                aria-label={`${type} settings`}
              >
                <PlanInsights
                  type={type}
                  id={id}
                  request={request}
                  writable={writable}
                  onUpdate={onUpdate}
                />
                <PlanTeam
                  type={type}
                  id={id}
                  request={request}
                  writable={writable}
                />
                <PlanFinancial
                  type={type}
                  id={id}
                  request={request}
                  writable={writable}
                  onUpdate={onUpdate}
                />
                {type === "project" && (
                  <details
                    onToggle={(e) => setCollaborating(e.currentTarget.open)}
                  >
                    <summary>
                      Team & client collaboration · chat, files & sharing
                    </summary>
                    {collaborating && (
                      <ProjectCollaboration
                        projectId={id}
                        request={request}
                        shareLink={shareLink}
                        downloadFile={downloadFile}
                      />
                    )}
                  </details>
                )}
              </section>
            ) : (
              <PlanSuccess
                type={type}
                id={id}
                writable={writable}
                request={request}
                active={tab === "success"}
                onUpdate={onUpdate}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
function GoalProjectMaps({
  id,
  writable,
  request,
  onUpdate,
}: {
  id: string;
  writable: boolean;
  request: Transport;
  onUpdate?: () => Promise<void>;
}) {
  const [projects, setProjects] = useState<
      { id: string; title: string }[] | null
    >(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    request("/api/project-wbs?goalId=" + encodeURIComponent(id))
      .then((v) => {
        if (live) setProjects(v.projects);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [request, id]);
  return (
    <div className="goal-project-maps">
      <ProjectWbs
        projectId={id}
        planType="goal"
        writable={writable}
        request={request}
        onUpdate={onUpdate}
      />
      {error && (
        <p role="alert" className="plan-tool-error">
          {error}
        </p>
      )}
      {!projects && !error && <p>Loading supporting projects…</p>}
      {projects?.map((p) => (
        <section key={p.id}>
          <h4>{p.title}</h4>
          <ProjectWbs
            projectId={p.id}
            writable={writable}
            request={request}
            onUpdate={onUpdate}
          />
        </section>
      ))}
      {projects && !projects.length && (
        <div className="success-empty">
          <Network size={25} />
          <h4>Build this goal through projects</h4>
          <p>
            Choose this goal in a project’s “Supports goal” field. Its WBS will
            appear here so you can plan the work without duplicating activities.
          </p>
        </div>
      )}
    </div>
  );
}
