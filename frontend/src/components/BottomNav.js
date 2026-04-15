import { useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "../utils/erp";

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-4 left-1/2 z-40 w-[min(92%,32rem)] -translate-x-1/2 rounded-[24px] border border-white/10 bg-black/60 p-2 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="grid grid-cols-5 gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center rounded-[18px] px-2 py-3 text-center transition ${
                isActive
                  ? "bg-gradient-to-br from-violet-500/30 to-fuchsia-400/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-semibold tracking-[0.2em]">
                {item.shortLabel}
              </span>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
