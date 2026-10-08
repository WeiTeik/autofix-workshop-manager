import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AutoFix | Workshop inventory", description: "Parts, stock movements and accurate repair estimates for AutoFix Workshop." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
