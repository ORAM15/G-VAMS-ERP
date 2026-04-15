import BottomNav from "./BottomNav";
import { getInitials } from "../utils/erp";

function ErpShell({
  title,
  subtitle,
  profileName = "Student",
  rightSlot = null,
  children,
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.32),_transparent_30%),linear-gradient(180deg,#07070b_0%,#0f0b19_48%,#08080d_100%)] text-white">
      <div className="mx-auto min-h-screen max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:px-8">
        <header className="glass-panel sticky top-4 z-30 mb-8 flex items-center justify-between gap-4 rounded-[24px] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-200/70">
              G-VAMS ERP
            </p>
            <h1 className="truncate text-xl font-semibold sm:text-2xl">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {rightSlot}
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-violet-300/25 bg-gradient-to-br from-violet-500/35 to-fuchsia-400/10 text-sm font-semibold text-violet-100">
              {getInitials(profileName)}
            </div>
          </div>
        </header>

        <main>{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}

export default ErpShell;
