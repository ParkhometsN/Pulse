import React from "react";

const Inputs = ({ 
  variant = "primary",  
  type = "text",       
  value, 
  onChange,
  onFocus,
  onBlur,
  id,
  name,
  disabled, 
  placeholder,
  icon,
  autoComplete,
  required,
}) => {

  const inputclass = `
    input 
    input--${variant} 
    ${disabled ? "input--disabled" : ""} 
    ${icon ? "input--has-icon" : ""}
  `;

  return (
    <div className="input-container">
  <input   
    id={id || name}
    name={name || id || `input-${variant}`}
    className={inputclass}
    type={type}
    value={value}
    onChange={onChange}
    onFocus={onFocus}
    onBlur={onBlur}
    disabled={disabled}
    placeholder={placeholder}
    autoComplete={autoComplete}
    required={required}
  />

  {icon && (
    <img 
      src={icon} 
      alt="icon" 
      className="input__icon"
    />
  )}
</div>
  );
};

export default Inputs;
