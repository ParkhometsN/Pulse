import Buttons from "../UI/buttons";
import LoaderAnimation from "./loaderAnimation";

export default function TextAlert({
    TextAlertButton,
    title = "Сводка GPT",
    children,
    isLoading = false,
    error = "",
}){
    return (
        <>
        <div className="containerTEXtAket">
            <div className="TextAlert-content">
                <div className="controolTextAlert">
                    <h1>{title}</h1>
                    <Buttons onClick={TextAlertButton} type='nm_black_prymary'>
                        <span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                            </svg>
                        </span>
                    </Buttons>
                </div>
                <div className="lineArea"></div>
                {isLoading ? (
                    <LoaderAnimation height={220} rounded="18px" />
                ) : error ? (
                    <p className="TextAlert-error">{error}</p>
                ) : (
                    <div className="TextAlert-body">
                        {children}
                    </div>
                )}
            </div>
        </div>
        </>
    )
}
