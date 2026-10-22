import AuthEmailAction from "@/components/auth-email-action";
export const metadata = { title: "Verify email", referrer: "no-referrer" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const p = await searchParams;
  return (
    <AuthEmailAction
      action="verify-email"
      token={typeof p.token === "string" ? p.token : ""}
    />
  );
}
