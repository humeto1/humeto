import { useState } from "react";
import "./plan-controls.css";
export function PlanTeam({
  type,
  id,
  request,
  writable,
}: {
  type: string;
  id: string;
  request: (path: string, body?: any) => Promise<any>;
  writable: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setData(
        await request(
          `/api/workspace/assignments?type=${type}&id=${encodeURIComponent(id)}`,
        ),
      );
      setOpen(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="plan-team-control">
      <button
        type="button"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        {data?.userIds.length
          ? `${data.userIds.length} assigned`
          : `Assign ${type === "routine" ? "routine" : type} team`}
      </button>
      {error && <p role="alert">{error}</p>}
      {open && data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            void request("/api/workspace/assignments", {
              type,
              id,
              revision: data.revision,
              userIds: f.getAll("userIds"),
            })
              .then(async () => {
                setData(
                  await request(
                    `/api/workspace/assignments?type=${type}&id=${encodeURIComponent(id)}`,
                  ),
                );
                setOpen(false);
                setError("");
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <p>Tasks inherit this team. Client access is separate.</p>
          {data.members.map((m: any) => (
            <label key={m.id}>
              <input
                type="checkbox"
                name="userIds"
                value={m.id}
                defaultChecked={data.userIds.includes(m.id)}
              />
              {m.name}
            </label>
          ))}
          <button disabled={busy || !writable}>Save {type} team</button>
        </form>
      )}
    </div>
  );
}
