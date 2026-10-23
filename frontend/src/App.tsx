import { useEffect, useState } from "react";
import SplashScreen from "./components/SplashScreen";
import BottomNavigation, {
  type Tab,
} from "./components/BottomNavigation";
import Home from "./pages/Home.tsx";
import Review from "./pages/Review.tsx";
import Activity from "./pages/Activity.tsx";
import Account from "./pages/Account.tsx";
import "./App.css";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [content, setContent] = useState("");
  const [reviewStarted, setReviewStarted] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand-lockup"
          onClick={() => {
            setActiveTab("Home");
            setReviewStarted(false);
          }}
          aria-label="Go to home"
        >
          <img src="/logo.jpg" alt="" />
          <span>before<span className="brand-accent">itgoes</span>live</span>
        </button>
        <div className="topbar-status">
          <span className="status-dot" />
          Brand workspace
        </div>
      </header>

      <main className="main-content">
        {activeTab === "Home" && (
          <Home
            content={content}
            setContent={setContent}
            onReview={() => {
              setReviewStarted(true);
              setActiveTab("Explore");
            }}
          />
        )}

        {activeTab === "Explore" && (
          <Review
            content={content}
            setContent={setContent}
            reviewStarted={reviewStarted}
            onReview={() => setReviewStarted(true)}
          />
        )}

        {activeTab === "Activity" && <Activity />}

        {activeTab === "Account" && (
          <Account darkMode={darkMode} setDarkMode={setDarkMode} />
        )}
      </main>

      <BottomNavigation activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}