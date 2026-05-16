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
                className={`loaderSpinner_wrap ${className}`.trim()}
                role="status"
                aria-label={label}
                aria-busy="true"
                style={style}
            >
                <span className="loaderSpinner" aria-hidden="true" />
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
        >
            <span className="loaderAnimation_line loaderAnimation_lineLarge" aria-hidden="true" />
            <span className="loaderAnimation_line loaderAnimation_lineMedium" aria-hidden="true" />
            <span className="loaderAnimation_line loaderAnimation_lineSmall" aria-hidden="true" />
            <span className="loaderAnimation_orb" aria-hidden="true" />
        </div>
    )
}
