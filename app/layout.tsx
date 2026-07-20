import type {Metadata} from 'next';
import { Orbitron, Roboto_Mono } from 'next/font/google';
import './globals.css';
import RegisterSW from '@/components/RegisterSW';
import { AuthProvider } from '@/lib/auth';

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-hud-display',
  weight: ['400', '500', '600', '700'],
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-hud-mono',
  weight: ['300', '400', '500'],
});

export const metadata: Metadata = {
  title: 'GAME — Reality Creator',
  description: 'Геймифицированный HUD с AGI-ассистентом',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-180.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GAME',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  themeColor: '#0a0818',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ru" className={`${orbitron.variable} ${robotoMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          // Fix for "Cannot set property fetch of #<Window> which has only a getter"
          (function() {
            try {
              var originalFetch = window.fetch;
              if (typeof originalFetch !== 'function') return;
              Object.defineProperty(window, 'fetch', {
                get: function() { return originalFetch; },
                set: function(v) { 
                  console.warn('Blocked attempt to overwrite fetch'); 
                  // Don't throw, just ignore
                },
                configurable: true,
                enumerable: true
              });
            } catch (e) {
              console.error('Failed to protect fetch:', e);
            }
          })();
        ` }} />
      </head>
      <body className="font-mono bg-[#0a0818] text-white antialiased" suppressHydrationWarning>
        <RegisterSW />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
