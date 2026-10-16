import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Humeto — a clearer next chapter",
    template: "%s · Humeto",
  },
  description:
    "Your students, documents, applications and next important steps, together.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
