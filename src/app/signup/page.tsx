import { actor } from "@/lib/auth";
import { redirect } from "next/navigation";
import Login from "@/components/login";
export default async function Page() {
  if (await actor()) redirect("/workspace");
  if (process.env.HUMETO_SIGNUP_ENABLED === "false") redirect("/login");
  return <Login demoEnabled={false} initialMode="register" />;
}
