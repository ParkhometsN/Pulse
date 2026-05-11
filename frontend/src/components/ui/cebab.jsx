import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const KebabMenu = ({ items = [], onItemClick, position = 'bottom-right' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Обновить позицию меню перед открытием
  const updateMenuPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      let top = 0;
      let left = 0;

      switch (position) {
        case 'bottom-right':
          top = rect.bottom + window.scrollY + 8;
          left = rect.right + window.scrollX - 180; // 180 - minWidth
          break;
        case 'bottom-left':
          top = rect.bottom + window.scrollY + 8;
          left = rect.left + window.scrollX;
          break;
        case 'top-right':
          top = rect.top + window.scrollY - 8;
          left = rect.right + window.scrollX - 180;
          break;
        case 'top-left':
          top = rect.top + window.scrollY - 8;
          left = rect.left + window.scrollX;
          break;
        default:
          top = rect.bottom + window.scrollY + 8;
          left = rect.left + window.scrollX;
      }

      // Корректировка, чтобы меню не выходило за границы экрана
      const menuWidth = 180;
      const viewportWidth = window.innerWidth;
      if (left + menuWidth > viewportWidth) {
        left = viewportWidth - menuWidth - 10;
      }
      if (left < 10) left = 10;

      setMenuPosition({ top, left });
    }
  }, [position]);

  // Открыть меню и рассчитать позицию
  const openMenu = () => {
    updateMenuPosition();
    setIsOpen(true);
  };

  // Закрыть при клике вне
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        menuRef.current && !menuRef.current.contains(event.target) &&
        buttonRef.current && !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

  // Закрыть по ESC
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  const handleItemClick = (item) => {
    if (onItemClick) onItemClick(item);
    setIsOpen(false);
  };

  const [isHovered, setIsHovered] = useState(false);

  const styles = {
    container: {
      position: 'relative',
      display: 'inline-block',
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      color: 'var(--white)',
      transition: 'background-color 0.2s ease',
    },
    buttonHover: {
      backgroundColor: 'var(--black-t)',
    },
    dots: {
      display: 'flex',
      gap: '3px',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: '4px',
      height: '4px',
      backgroundColor: 'var(--primary-blue)',
      borderRadius: '50%',
    },
    menu: {
      position: 'absolute',
      zIndex: 999999999,
      minWidth: '180px',
      backgroundColor: 'var(--black-s)',
      border: '1.5px solid var(--black-t)',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
      top: menuPosition.top,
      left: menuPosition.left,
    },
    menuItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      width: '100%',
      padding: '12px 16px',
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--white)',
      fontSize: '14px',
      fontWeight: '400',
      fontFamily: 'Inter, sans-serif',
      cursor: 'pointer',
      transition: 'background-color 0.2s ease',
      textAlign: 'left',
    },
    menuItemDanger: {
      color: 'var(--red)',
    },
    menuItemIcon: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      fontSize: '16px',
    },
    divider: {
      height: '1px',
      backgroundColor: 'var(--black-t)',
      margin: '4px 0',
    },
  };

  return (
    <div style={styles.container}>
      <button
        ref={buttonRef}
        style={{
          ...styles.button,
          ...(isHovered ? styles.buttonHover : {}),
        }}
        onClick={openMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Меню"
      >
        <div style={styles.dots}>
          <div style={styles.dot} />
          <div style={styles.dot} />
          <div style={styles.dot} />
        </div>
      </button>

      {isOpen && items.length > 0 &&
        createPortal(
          <div ref={menuRef} style={styles.menu}>
            {items.map((item, index) => (
              <React.Fragment key={item.id || index}>
                {item.divider && <div style={styles.divider} />}
                <button
                  style={{
                    ...styles.menuItem,
                    ...(item.danger ? styles.menuItemDanger : {}),
                  }}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--black-t)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {item.icon && <span style={styles.menuItemIcon}>{item.icon}</span>}
                  {item.label}
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

export default KebabMenu;
