import { Navigate, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";

import Landing from "../pages/public/Landing";
import Login from "../pages/public/Login";

import Dashboard from "../pages/app/Dashboard";
import Market from "../pages/app/Market";
import News from "../pages/app/News";
import Settings from "../pages/app/Settings";

import AppLayout from "../layouts/AppLayout";

import Register from "../pages/public/Register";

import ForgotPassword from "../pages/public/ForgotPassword";

import Profile from "../pages/app/Profile";
import CoinPage from "../pages/app/coinPage";
import api from "../lib/api";
import { clearAuthSession, getAccessToken, saveStoredUser } from "../lib/auth";
import LoaderAnimation from "../components/ui/loaderAnimation";

function ProtectedApp() {
  const [status, setStatus] = useState(() => getAccessToken() ? "checking" : "guest");

  useEffect(() => {
    if (!getAccessToken()) {
      return;
    }

    let isMounted = true;

    api.get("/auth/me")
      .then((response) => {
        if (!isMounted) {
          return;
        }

        saveStoredUser(response.data.user);
        setStatus("authorized");
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        clearAuthSession();
        setStatus("guest");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="route_auth_check">
        <LoaderAnimation className="route_auth_loader" variant="spinner" label="Проверяем сессию" />
      </div>
    );
  }

  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
}

export default function Router() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* App */}
      <Route path="/app" element={<ProtectedApp />}>
        <Route index element={<Dashboard/>} />
        <Route path="market" element={<Market />} />
        <Route path="market/coin-page" element={<CoinPage/>} />
        <Route path="news" element={<News/>} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<Profile/>} />
      </Route>
    </Routes>
  );
}
