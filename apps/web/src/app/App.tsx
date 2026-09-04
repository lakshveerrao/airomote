import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { activityComponents } from '@/activities';
import { activityRegistry } from '@/core/runtime';
import { useSettings } from '@/store/settings';
import { Spinner } from '@/ui';
import { useAutoReconnect } from '@/features/setup/useAutoReconnect';
import '@/styles/global.css';

const Landing = lazy(() => import('@/features/home/Landing'));
const SetupPage = lazy(() => import('@/features/setup/SetupPage'));
const CategoryPage = lazy(() => import('@/features/home/CategoryPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const DeveloperPage = lazy(() => import('@/features/diagnostics/DeveloperPage'));
const FactoryTestPage = lazy(() => import('@/features/diagnostics/FactoryTestPage'));
const HistoryPage = lazy(() => import('@/features/workout/HistoryPage'));

function Loading() {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <Spinner />
    </div>
  );
}

/** Renders the full-screen component for /:category/:activityId. */
function ActivityRoute() {
  const { activityId = '' } = useParams();
  const def = activityRegistry.get(activityId);
  const Component = activityComponents[activityId];
  const navigate = useNavigate();
  useEffect(() => {
    if (!def || !Component) navigate('/', { replace: true });
  }, [def, Component, navigate]);
  if (!def || !Component) return null;
  return (
    <Suspense fallback={<Loading />}>
      <Component definition={def} />
    </Suspense>
  );
}

function FirstRunGate({ children }: { children: React.ReactNode }) {
  const setupComplete = useSettings((s) => s.setupComplete);
  const location = useLocation();
  if (!setupComplete && location.pathname !== '/' && location.pathname !== '/setup' && !location.pathname.startsWith('/settings')) {
    return <Navigate to="/setup" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  useAutoReconnect();
  return (
    <FirstRunGate>
      <Routes>
        <Route path="/" element={<Suspense fallback={<Loading />}><Landing /></Suspense>} />
        <Route path="/setup" element={<Suspense fallback={<Loading />}><SetupPage /></Suspense>} />
        <Route path="/games/:activityId" element={<ActivityRoute />} />
        <Route path="/music/:activityId" element={<ActivityRoute />} />
        <Route path="/workout/history" element={<AppShell><Suspense fallback={<Loading />}><HistoryPage /></Suspense></AppShell>} />
        <Route path="/workout/:activityId" element={<ActivityRoute />} />
        <Route
          element={
            <AppShell>
              <Suspense fallback={<Loading />}>
                <ShellOutlet />
              </Suspense>
            </AppShell>
          }
        >
          <Route path="/games" element={<CategoryPage category="games" />} />
          <Route path="/music" element={<CategoryPage category="music" />} />
          <Route path="/workout" element={<CategoryPage category="workout" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/developer" element={<DeveloperPage />} />
          <Route path="/settings/factory" element={<FactoryTestPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </FirstRunGate>
  );
}

import { Outlet } from 'react-router-dom';
function ShellOutlet() {
  return <Outlet />;
}
