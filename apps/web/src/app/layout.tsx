import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "한국 철도 노선 지도 | Railmap",
  description:
    "한국 도시철도와 철도 노선을 지도에서 검색하고, 역·환승 그룹·노선 구간을 확인하는 공개 철도 지도입니다.",
  openGraph: {
    title: "한국 철도 노선 지도 | Railmap",
    description:
      "한국 도시철도와 철도 노선을 지도에서 검색하고, 역·환승 그룹·노선 구간을 확인하세요.",
    type: "website",
    locale: "ko_KR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
