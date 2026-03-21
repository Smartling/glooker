import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from './theme-context';

export const metadata: Metadata = {
  title: 'Glooker — GitHub Analytics',
  description: 'Developer impact analytics for your GitHub org',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0F0F0F] text-gray-100 min-h-screen antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
