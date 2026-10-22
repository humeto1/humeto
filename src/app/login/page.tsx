import { actor, demoAllowed } from "@/lib/auth";
import { redirect } from "next/navigation";
import Login from "@/components/login";
export default async function Page() {
  if (await actor()) redirect("/workspace");
  return (
    <Login
      demoEnabled={await demoAllowed()}
      signupEnabled={process.env.HUMETO_SIGNUP_ENABLED !== "false"}
    />
  );
}
