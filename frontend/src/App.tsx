import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './features/auth/AuthContext'
import { OfflineLayer } from './offline/OfflineLayer'
import { AppRouter } from './routes/AppRouter'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Keep data around for a day so the persisted copy (FE-51) is useful offline.
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <OfflineLayer />
            <AppRouter />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export default App
