import { Navigate, Outlet } from "react-router-dom";

function ProtectedRoute({ isAuthenticated, authReady }) {
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] text-white flex items-center justify-center">
        Checking session...
      </div>
    );
  }

  return authReady && isAuthenticated ? <Outlet /> : <Navigate to="/" replace />;
}

export default ProtectedRoute;
