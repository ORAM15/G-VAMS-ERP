export const NAV_ITEMS = [
  { label: "LMS", path: "/lms", shortLabel: "LM" },
  { label: "Performance", path: "/subjects", shortLabel: "PF" },
  { label: "Home", path: "/dashboard", shortLabel: "HM" },
  { label: "Timetable", path: "/timetable", shortLabel: "TT" },
  { label: "Analytics", path: "/leave", shortLabel: "AN" },
];

export const getGreeting = () => {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good Morning";
  }

  if (hour < 17) {
    return "Good Afternoon";
  }

  return "Good Evening";
};

export const getInitials = (value = "Student") =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

export const getTodayLabel = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

export const getStatusTone = (percentage) => {
  if (percentage >= 85) {
    return "emerald";
  }

  if (percentage >= 75) {
    return "violet";
  }

  return "rose";
};

export const toneClasses = {
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
  violet: "text-violet-200 bg-violet-500/10 border-violet-400/20",
  rose: "text-rose-200 bg-rose-500/10 border-rose-400/20",
};
