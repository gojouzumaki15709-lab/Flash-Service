import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flash Service",
  description: "Achète tes sucreries et boissons directement auprès des vendeurs de ton bâtiment.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
