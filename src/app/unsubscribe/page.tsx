export const metadata = { title: "Email preferences", referrer: "no-referrer" };
import Unsubscribe from "@/components/unsubscribe";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const p = await searchParams;
  return <Unsubscribe token={typeof p.token === "string" ? p.token : ""} />;
}
