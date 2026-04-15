import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <div className="w-64 h-screen bg-gray-900 text-white p-5">
      <h2 className="text-xl font-bold mb-6">Pulse</h2>

      <nav className="flex flex-col gap-3">
        <Link to="/app">Главное меню</Link>
        <Link to="/app/portfolio">Портфель</Link>
        <Link to="/app/market">Торговая площадка</Link>
        <Link to="/app/news">Новости</Link>
        <Link to="/app/settings">Настройки</Link>
      </nav>
    </div>
  );
}
