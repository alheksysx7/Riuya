import type { Metadata } from "next";
import "./globals.css";
import {OfflineRegistration} from "./components/offline-registration";

export const metadata: Metadata = { title: "Riuya", description: "Riuya en desarrollo local" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><OfflineRegistration />{children}</body></html>;
}
