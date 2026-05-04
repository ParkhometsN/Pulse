import { Routes, Route } from "react-router-dom";

import Landing from "../pages/public/Landing";
import Login from "../pages/public/Login";

import Dashboard from "../pages/app/Dashboard";
import Market from "../pages/app/Market";
import News from "../pages/app/News";
import Settings from "../pages/app/Settings";

import AppLayout from "../layouts/AppLayout";

import Register from "../pages/public/Register.jsx";

import ForgotPassword from "../pages/public/ForgotPassword.jsx";

import Profile from "../pages/app/Profile.jsx";
import CoinPage from "../pages/app/coinPage.jsx";

export default function Router() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* App */}
      <Route path="/app" element={<AppLayout />}>
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
