import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sucrerie App",
  description: "Achète tes sucreries et boissons directement auprès des vendeurs de ton bâtiment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
