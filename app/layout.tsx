import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'My Google AI Studio App',
  description: 'My Google AI Studio App',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          // Fix for "Cannot set property fetch of #<Window> which has only a getter"
          (function() {
            try {
              var originalFetch = window.fetch;
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
      <body className="font-mono bg-[#050505] text-white" suppressHydrationWarning>{children}</body>
    </html>
  );
}
