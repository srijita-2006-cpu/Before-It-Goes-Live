import "./SplashScreen.css";

type Props = {
  onFinish: () => void;
};

export default function SplashScreen({ onFinish }: Props) {
  return (
    <div className="splash-screen">
      <div className="splash-glow splash-glow-one" />
      <div className="splash-glow splash-glow-two" />

      <div className="splash-content">
        <img
          src="/logo.jpg"
          alt="Before It Goes Live logo"
          className="splash-logo"
        />

        <p className="eyebrow">BRAND GOVERNANCE, REIMAGINED</p>
        <h1>
          Before it
          <br />
          goes <span>live.</span>
        </h1>

        <p className="splash-description">
          Every detail matters. Review your content before the world sees it.
        </p>

        <div className="splash-loader">
          <span />
        </div>
      </div>

      <button className="splash-continue" onClick={onFinish}>
        Enter workspace <span>↗</span>
      </button>

      <p className="splash-footer">MADE FOR MORE CONSISTENT BRANDS</p>
    </div>
  );
}