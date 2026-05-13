// Buttons.jsx
import React from 'react';


const Buttons = ({ type, children, onClick, disabled, className = "", htmlType = "button", ...props }) => {
  const buttonClass = `button button--${type || 'primary'} ${className} ${disabled ? 'button--disabled' : ''}`;

  return (
    <button 
      className={buttonClass}
      onClick={onClick}
      disabled={disabled}
      type={htmlType}
      {...props}
    >
      {children}
    </button>
  );
};

export default Buttons;
