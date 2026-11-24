import { Route, Routes } from 'react-router-dom'
import { CaretakerHomePage } from './CaretakerHomePage'
import { DevUiPage } from './DevUiPage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { LoginPage } from './LoginPage'
import { OrgPickerPage } from './OrgPickerPage'
import { OwnerDashboardPage } from './OwnerDashboardPage'
import { OwnerMorePage } from './OwnerMorePage'
import { StaffPage } from '@/features/staff/StaffPage'
import { CaretakerLayoutRoute, OwnerLayoutRoute, RoleRedirect } from './ProtectedRoutes'
import { SignupPage } from './SignupPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/select-org" element={<OrgPickerPage />} />
      <Route path="/dev/ui" element={<DevUiPage />} />

      <Route path="/owner" element={<OwnerLayoutRoute />}>
        <Route index element={<OwnerDashboardPage section="Dashboard" />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="properties" element={<OwnerDashboardPage section="Properties" />} />
        <Route path="money" element={<OwnerDashboardPage section="Money" />} />
        <Route path="more" element={<OwnerMorePage />} />
        <Route path="staff" element={<StaffPage />} />
      </Route>

      <Route path="/caretaker" element={<CaretakerLayoutRoute />}>
        <Route index element={<CaretakerHomePage section="Home" />} />
        <Route path="check-ins" element={<CaretakerHomePage section="Check-ins" />} />
        <Route path="payments" element={<CaretakerHomePage section="Payments" />} />
        <Route path="expenses" element={<CaretakerHomePage section="Expenses" />} />
        <Route path="more" element={<CaretakerHomePage section="More" />} />
      </Route>
    </Routes>
  )
}
