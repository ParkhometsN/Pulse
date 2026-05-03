export default function LoaderAnimation({
    className = "",
    height,
    rounded = "16px",
    label = "Загрузка",
}){
    return (
        <div
            className={`container_loading_element ${className}`.trim()}
            role="status"
            aria-label={label}
            style={{
                minHeight: height,
                borderRadius: rounded,
            }}
        />
    )
}
