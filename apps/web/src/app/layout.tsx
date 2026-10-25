import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "HoloConnect AI — Presence beyond distance", description: "An intelligent, 5G-ready holographic telepresence prototype." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
