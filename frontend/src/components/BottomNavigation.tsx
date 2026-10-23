import {
  House,
  ScanSearch,
  History,
  UserRound,
} from "lucide-react";

export type Tab = "Home" | "Explore" | "Activity" | "Account";

type Props = {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
};

const tabs = [
  { name: "Home", icon: House },
  { name: "Explore", icon: ScanSearch },
  { name: "Activity", icon: History },
  { name: "Account", icon: UserRound },
] as const;

export default function BottomNavigation({
  activeTab,
  onChange,
}: Props) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ name, icon: Icon }) => (
        <button
          key={name}
          className={`nav-item ${activeTab === name ? "active" : ""}`}
          onClick={() => onChange(name)}
          aria-current={activeTab === name ? "page" : undefined}
        >
          <Icon size={21} strokeWidth={1.8} />
          <span>{name}</span>
        </button>
      ))}
    </nav>
  );
}


