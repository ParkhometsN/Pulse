export default function LoaderAnimation({
    className = "",
    height,
    rounded = "16px",
    label = "Загрузка",
    variant = "skeleton",
}){
    if (variant === "spinner") {
        return (
            <div
                className={`loaderSpinner_wrap ${className}`.trim()}
                role="status"
                aria-label={label}
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
            style={{
                minHeight: height,
                height,
                borderRadius: rounded,
            }}
        >
            <span className="loaderAnimation_line loaderAnimation_lineLarge" aria-hidden="true" />
            <span className="loaderAnimation_line loaderAnimation_lineMedium" aria-hidden="true" />
            <span className="loaderAnimation_line loaderAnimation_lineSmall" aria-hidden="true" />
            <span className="loaderAnimation_orb" aria-hidden="true" />
        </div>
    )
}
