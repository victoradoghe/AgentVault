import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "AgentVault",
  description: "Cloud memory service for AI coding agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
        // Browser extensions (e.g. Grammarly) inject attributes onto <body>
        // before hydration; suppress the resulting attribute mismatch warning.
        suppressHydrationWarning
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
