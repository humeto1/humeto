import SharedTask from "./shared-project";
export const metadata = {
  referrer: "no-referrer",
  title: "Shared project · Humeto",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: 20 }}>
      <h1>Humeto</h1>
      <SharedTask token={token} />
    </main>
  );
}
