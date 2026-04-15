import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import Timetable from "./pages/Timetable";
import Attendance from "./pages/Attendance";
import LMS from "./pages/LMS";
import Leave from "./pages/Leave";
import ProtectedRoute from "./components/ProtectedRoute";
import { apiRequest } from "./utils/api";
import { clearSession, getToken, saveSession } from "./utils/auth";

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const validateSession = async () => {
      const storedToken = getToken();
      console.debug("[auth] Stored token on load:", storedToken);

      if (isMounted) {
        setAuthReady(false);
        setIsAuthenticated(false);
        setCurrentUser(null);
      }

      if (!storedToken) {
        if (isMounted) {
          clearSession();
          setAuthReady(true);
        }
        return;
      }

      try {
        const data = await apiRequest("/auth/validate");
        console.debug("[auth] Validation result:", data);

        if (isMounted) {
          setCurrentUser(data.user);
          setIsAuthenticated(true);
          saveSession({ token: storedToken, user: data.user });
        }
      } catch (error) {
        console.debug("[auth] Validation failed:", error.message);
        if (isMounted) {
          clearSession();
          setCurrentUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (isMounted) {
          setAuthReady(true);
        }
      }
    };

    validateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    console.debug("[auth] isAuthenticated:", isAuthenticated);
  }, [isAuthenticated]);

  const handleLoginSuccess = ({ token, user }) => {
    saveSession({ token, user });
    setCurrentUser(user);
    setIsAuthenticated(true);
    setAuthReady(true);
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setAuthReady(true);
  };

  const rootElement = !authReady ? (
    <div className="min-h-screen bg-[#0e0e0e] text-white flex items-center justify-center">
      Checking session...
    </div>
  ) : !isAuthenticated ? (
    <Login authReady={authReady} onLoginSuccess={handleLoginSuccess} />
  ) : (
    <Navigate to="/dashboard" replace />
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={rootElement} />
        <Route
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              authReady={authReady}
            />
          }
        >
          <Route
            path="/dashboard"
            element={<Dashboard currentUser={currentUser} onLogout={handleLogout} />}
          />
          <Route path="/subjects" element={<Subjects />} />
          <Route path="/timetable" element={<Timetable />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/lms" element={<LMS />} />
          <Route path="/leave" element={<Leave />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
