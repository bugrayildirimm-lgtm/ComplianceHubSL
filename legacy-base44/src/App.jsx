import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import AppLayout from '@/components/AppLayout';
// Add page imports here
import Dashboard from '@/pages/Dashboard';
import Jurisdictions from '@/pages/Jurisdictions';
import JurisdictionDetail from '@/pages/JurisdictionDetail';
import RegulatoryRadar from '@/pages/RegulatoryRadar';
import AlertDetail from '@/pages/AlertDetail';
import RequirementsLibrary from '@/pages/RequirementsLibrary';
import BaselineResearch from '@/pages/BaselineResearch';
import RequirementDetail from '@/pages/RequirementDetail';
import LicencesStudios from '@/pages/LicencesStudios';
import ActionsDeadlines from '@/pages/ActionsDeadlines';
import SourcesMonitoring from '@/pages/SourcesMonitoring';
import DiscoveryReview from '@/pages/DiscoveryReview';
import Approvals from '@/pages/Approvals';
import Reports from '@/pages/Reports';
import Administration from '@/pages/Administration';
import AccessAcceptance from '@/pages/AccessAcceptance';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
      <Route path="/access-acceptance" element={<AccessAcceptance />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jurisdictions" element={<Jurisdictions />} />
        <Route path="/jurisdictions/:jurisdictionId" element={<JurisdictionDetail />} />
        <Route path="/radar" element={<RegulatoryRadar />} />
        <Route path="/radar/:alertId" element={<AlertDetail />} />
        <Route path="/requirements" element={<RequirementsLibrary />} />
        <Route path="/baseline" element={<BaselineResearch />} />
        <Route path="/requirements/:requirementId" element={<RequirementDetail />} />
        <Route path="/licences" element={<LicencesStudios />} />
        <Route path="/actions" element={<ActionsDeadlines />} />
        <Route path="/sources" element={<SourcesMonitoring />} />
        <Route path="/discovery" element={<DiscoveryReview />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/administration" element={<Administration />} />
      </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App