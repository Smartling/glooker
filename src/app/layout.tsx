import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { ThemeProvider } from './theme-context';
import { AuthProvider } from './auth-context';
import SWRProvider from '@/lib/swr-provider';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Glooker — GitHub Analytics',
  description: 'Developer impact analytics for your GitHub org',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0F0F0F] text-gray-100 min-h-screen antialiased">
        <ThemeProvider>
          <SWRProvider>
            <AuthProvider>
              <Suspense>
                <NavBar />
              </Suspense>
              {children}
              <Footer />
            </AuthProvider>
          </SWRProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
