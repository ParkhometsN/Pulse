import Buttons from "../../components/ui/buttons";

export default function AreYouShure({
    TitledilogAlert,
    Descriptionactive,
    BackButtonAlertText,
    ShureButtonAlertText,
    onClickBackAlert,
    onClickShureAlert
}){
    return(
        <>
        <div className="shure_conteuner">
            <div className="container_shure">
                <div className="boxDilog black_box">
                    <div className="textdilogAlert">
                        <h1>{TitledilogAlert}</h1>
                        <p>{Descriptionactive}</p>
                    </div>
                    <div className="line_dilog"></div>
                    <div className="container_buttons_shure">
                        <Buttons onClick={onClickBackAlert} type="alert_dilog">{BackButtonAlertText}</Buttons>
                        <Buttons onClick={onClickShureAlert} type="alert_dilog-red">{ShureButtonAlertText}</Buttons>
                    </div>
                </div>
            </div>
        </div>
        </>
    )
}

// все стили в indexcss