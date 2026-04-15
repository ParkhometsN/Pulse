import React from 'react';

const Inputs = ({ 
  variant = 'primary',  
  type = 'text',       
  value, 
  disabled, 
  placeholder 
}) => {
  const inputclass = `input input--${variant} ${disabled ? 'input--disabled' : ''}`;

  return (
    <input   
      className={inputclass}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
};

export default Inputs;