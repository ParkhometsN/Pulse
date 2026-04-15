import LogoSvg from "../../assets/svg/pulse_logo.svg";

const Preloader = () => {
    return (
        <>
        <div className="preloader_animation">
            <img src={LogoSvg} alt="Pulse logo" />
        </div>
        </>
    )
}

export default Preloader;