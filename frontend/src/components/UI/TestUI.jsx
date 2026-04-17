import { useState, useCallback } from 'react';

export default function TestUI() {
  const [isOpen, setIsOpen] = useState(true);
  
  const toggleSidebar = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <>
      <div className={`sidebar ${isOpen ? 'visible' : 'hidden'}`}>
        <button className="toggle-btn" onClick={toggleSidebar}>
          {isOpen ? '✕' : '☰'}
        </button>
        <div className="sidebar-content">
          {/* Ваш контент сайдбара */}
          <nav>
            <a href="/">Главная</a>
            <a href="/profile">Профиль</a>
            <a href="/settings">Настройки</a>
          </nav>
        </div>
      </div>
      
      {!isOpen && (
        <button className="show-sidebar-btn" onClick={toggleSidebar}>
          ☰
        </button>
      )}
    </>
  );
}