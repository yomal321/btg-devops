import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from './lib/theme'
import { AuthProvider, AuthGate } from './lib/auth'
import { ModelProvider } from './lib/model'
import { AppShell } from './components/AppShell'

export const metadata: Metadata = {
  title: 'BTG DevOps — Azure Audit Console',
  description: 'Monitor and analyze your Azure infrastructure',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ModelProvider>
              <AuthGate>
                <AppShell>
                  {children}
                </AppShell>
              </AuthGate>
            </ModelProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
