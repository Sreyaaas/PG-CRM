import { Route, Routes } from 'react-router-dom'
import { DevUiPage } from './DevUiPage'
import { HomePage } from './HomePage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dev/ui" element={<DevUiPage />} />
      <Route path="/caretaker/*" element={<DevUiPage />} />
      <Route path="/owner/*" element={<DevUiPage />} />
    </Routes>
  )
}
