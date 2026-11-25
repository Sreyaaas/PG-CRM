import { Route, Routes } from 'react-router-dom'
import { CaretakerHomePage } from './CaretakerHomePage'
import { DevUiPage } from './DevUiPage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { CheckInDetailPage } from '@/features/checkins/CheckInDetailPage'
import { CheckInsPage } from '@/features/checkins/CheckInsPage'
import { LoginPage } from './LoginPage'
import { OrgPickerPage } from './OrgPickerPage'
import { OwnerDashboardPage } from './OwnerDashboardPage'
import { CaretakerMorePage, OwnerMorePage } from './MorePages'
import { StaffPage } from '@/features/staff/StaffPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { CaretakerLayoutRoute, OwnerLayoutRoute, RoleRedirect } from './ProtectedRoutes'
import { PropertiesListPage } from '@/features/properties/PropertiesListPage'
import { PropertyDetailPage } from '@/features/properties/PropertyDetailPage'
import { PropertyCreatePage, PropertyEditPage } from '@/features/properties/PropertyFormPage'
import { RoomsPage } from '@/features/rooms/RoomsPage'
import { PosterPage } from '@/features/poster/PosterPage'
import { JoinPage } from '@/features/join/JoinPage'
import { BedBoardPage } from '@/features/beds/BedBoardPage'
import { ResidentDetailPage } from '@/features/residents/ResidentDetailPage'
import { ReconcilePage } from '@/features/reconciliation/ReconcilePage'
import { MyCashPage } from '@/features/cash/MyCashPage'
import { OwnerCaretakerCashPage, OwnerCashPage } from '@/features/cash/OwnerCashPage'
import { ReceiptPage } from '@/features/receipt/ReceiptPage'
import { SignupPage } from './SignupPage'
import { DuesPage } from '@/features/dues/DuesPage'
import { LedgerPage } from '@/features/dues/LedgerPage'
import { SettlementPage } from '@/features/settlement/SettlementPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/select-org" element={<OrgPickerPage />} />
      <Route path="/join/:slug" element={<JoinPage />} />
      <Route path="/receipt/:token" element={<ReceiptPage />} />
      <Route path="/dev/ui" element={<DevUiPage />} />

      <Route path="/owner" element={<OwnerLayoutRoute />}>
        <Route index element={<OwnerDashboardPage section="Today" />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="check-ins" element={<CheckInsPage />} />
        <Route path="check-ins/:requestId" element={<CheckInDetailPage />} />
        <Route path="properties" element={<PropertiesListPage />} />
        <Route path="properties/new" element={<PropertyCreatePage />} />
        <Route path="properties/:propertyId" element={<PropertyDetailPage />} />
        <Route path="properties/:propertyId/edit" element={<PropertyEditPage />} />
        <Route path="properties/:propertyId/rooms" element={<RoomsPage />} />
        <Route path="properties/:propertyId/beds" element={<BedBoardPage />} />
        <Route path="properties/:propertyId/poster" element={<PosterPage />} />
        <Route path="beds" element={<BedBoardPage />} />
        <Route path="residents/:residentId" element={<ResidentDetailPage />} />
        <Route path="money" element={<DuesPage />} />
        <Route path="money/reconcile" element={<ReconcilePage />} />
        <Route path="money/cash" element={<OwnerCashPage />} />
        <Route path="money/cash/:userId" element={<OwnerCaretakerCashPage />} />
        <Route path="residents/:residentId/ledger" element={<LedgerPage />} />
        <Route path="residents/:residentId/settlement/:stayId" element={<SettlementPage />} />
        <Route path="more" element={<OwnerMorePage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/caretaker" element={<CaretakerLayoutRoute />}>
        <Route index element={<CaretakerHomePage section="Home" />} />
        <Route path="beds" element={<BedBoardPage />} />
        <Route path="residents/:residentId" element={<ResidentDetailPage />} />
        <Route path="check-ins" element={<CheckInsPage />} />
        <Route path="check-ins/:requestId" element={<CheckInDetailPage />} />
        <Route path="payments" element={<DuesPage />} />
        <Route path="residents/:residentId/ledger" element={<LedgerPage />} />
        <Route path="residents/:residentId/settlement/:stayId" element={<SettlementPage />} />
        <Route path="expenses" element={<CaretakerHomePage section="Expenses" />} />
        <Route path="cash" element={<MyCashPage />} />
        <Route path="more" element={<CaretakerMorePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
