import "./SplashScreen.css";

type SplashScreenProps = {
  onFinish: () => void;
};

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <img
          src="/logo.jpg"
          alt="Before It Goes Live"
          className="splash-logo"
        />

        <h1>Before It Goes Live</h1>
        <p>Pause. Check. Then share.</p>

        <div className="splash-loader">
          <span />
        </div>
      </div>

      <button className="splash-continue" onClick={onFinish}>
        Get started
      </button>
    </div>
  );
}
