import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'eBay Order Updater', description: 'Import daily eBay orders into your shared monthly Google Sheet.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
