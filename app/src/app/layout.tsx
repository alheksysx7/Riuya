import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Riuya", description: "Riuya en desarrollo local" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
