export default function LoaderAnimation({
    className = "",
    height = 96,
    rounded = "16px",
    label = "Загрузка",
    variant = "skeleton",
    style,
}){
    if (variant === "spinner") {
        return (
            <div
                className={`loaderPulse_wrap ${className}`.trim()}
                role="status"
                aria-label={label}
                aria-busy="true"
                style={style}
            >
                <span>{label}</span>
            </div>
        )
    }

    return (
        <div
            className={`container_loading_element ${className}`.trim()}
            role="status"
            aria-label={label}
            aria-busy="true"
            style={{
                minHeight: height,
                height,
                borderRadius: rounded,
                ...style,
            }}
        />
    )
}
