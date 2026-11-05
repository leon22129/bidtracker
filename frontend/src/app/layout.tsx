import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { ToastProvider } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: 'BidTracker — Job Application Management',
  description: 'Collaborative job application tracking, bidder payment and recruiting analytics',
  applicationName: 'BidTracker365',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico?v=1', sizes: '16x16 32x32 48x48' },
      { url: '/icon.svg?v=1', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = { themeColor: '#10283F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
