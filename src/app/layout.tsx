import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Glooker — GitHub Analytics',
  description: 'Developer impact analytics for your GitHub org',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
