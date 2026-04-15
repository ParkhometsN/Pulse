// Buttons.jsx
import React from 'react';

const Buttons = ({ type, children, onClick, disabled }) => {
  const buttonClass = `button button--${type || 'primary'} ${disabled ? 'button--disabled' : ''}`;

  return (
    <button 
      className={buttonClass}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default Buttons;