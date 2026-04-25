import React from "react";

const Inputs = ({ 
  variant = "primary",  
  type = "text",       
  value, 
  disabled, 
  placeholder,
  icon
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
    className={inputclass}
    type={type}
    value={value}
    disabled={disabled}
    placeholder={placeholder}
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