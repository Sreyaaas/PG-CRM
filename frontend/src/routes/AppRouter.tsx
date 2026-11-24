import { Route, Routes } from 'react-router-dom'
import { CaretakerHomePage } from './CaretakerHomePage'
import { DevUiPage } from './DevUiPage'
import { LoginPage } from './LoginPage'
import { OrgPickerPage } from './OrgPickerPage'
import { OwnerDashboardPage } from './OwnerDashboardPage'
import { CaretakerLayoutRoute, OwnerLayoutRoute, RoleRedirect } from './ProtectedRoutes'
import { PropertiesListPage } from '@/features/properties/PropertiesListPage'
import { PropertyDetailPage } from '@/features/properties/PropertyDetailPage'
import { PropertyCreatePage, PropertyEditPage } from '@/features/properties/PropertyFormPage'
import { RoomsPage } from '@/features/rooms/RoomsPage'
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
        <Route path="approvals" element={<OwnerDashboardPage section="Approvals" />} />
        <Route path="properties" element={<PropertiesListPage />} />
        <Route path="properties/new" element={<PropertyCreatePage />} />
        <Route path="properties/:propertyId" element={<PropertyDetailPage />} />
        <Route path="properties/:propertyId/edit" element={<PropertyEditPage />} />
        <Route path="properties/:propertyId/rooms" element={<RoomsPage />} />
        <Route path="money" element={<OwnerDashboardPage section="Money" />} />
        <Route path="more" element={<OwnerDashboardPage section="More" />} />
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
