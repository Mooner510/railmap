import type { Metadata } from "next";
import "pretendard/dist/web/static/pretendard.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Railmap Local Editor",
  description: "Local editor for manual railmap overlays",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
