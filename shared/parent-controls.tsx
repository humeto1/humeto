import { useState } from "react";
import { PlanTeam } from "./plan-team";
import { PlanFinancial } from "./plan-financial";
import { ProjectCollaboration } from "./project-collaboration";
import { webApi, type Transport } from "./planning-hub";
export function ParentControls({
  type,
  id,
  writable,
  request = webApi,
  shareLink,
  downloadFile,
}: {
  type: "project" | "goal";
  id: string;
  writable: boolean;
  request?: Transport;
  shareLink?: (url: string, title: string) => Promise<void>;
  downloadFile?: (path: string, name: string) => Promise<void>;
}) {
  const [collaborating, setCollaborating] = useState(false);
  return (
    <div
      className="parent-controls"
      style={{
        display: "grid",
        gap: 10,
        marginTop: 12,
        overflowWrap: "anywhere",
      }}
    >
      <PlanTeam type={type} id={id} request={request} writable={writable} />
      <PlanFinancial
        type={type}
        id={id}
        request={request}
        writable={writable}
      />
      {type === "project" && (
        <details onToggle={(e) => setCollaborating(e.currentTarget.open)}>
          <summary>Team & client collaboration · chat, files & sharing</summary>
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
    </div>
  );
}
