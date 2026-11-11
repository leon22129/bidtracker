import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { ToastProvider } from '@/components/ui/toast';
import { ThemeProvider } from '@/lib/theme-context';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { CHUNK_RECOVERY_SCRIPT } from '@/lib/chunk-recovery';

// Always retrieve the current document/RSC manifest after a deployment. Hashed
// JS/CSS assets keep their immutable cache policy.
export const dynamic = 'force-dynamic';

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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script id="bidtracker-asset-recovery" dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
