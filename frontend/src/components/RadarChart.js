function RadarChart({ data }) {
  const size = 320;
  const center = size / 2;
  const radius = 110;
  const levels = [20, 40, 60, 80, 100];

  const buildPolygon = (scale) =>
    data
      .map((item, index) => {
        const angle = (Math.PI * 2 * index) / data.length - Math.PI / 2;
        const distance = radius * scale;
        const x = center + Math.cos(angle) * distance;
        const y = center + Math.sin(angle) * distance;
        return `${x},${y}`;
      })
      .join(" ");

  const points = data
    .map((item, index) => {
      const angle = (Math.PI * 2 * index) / data.length - Math.PI / 2;
      const distance = radius * (item.percentage / 100);

      return {
        ...item,
        x: center + Math.cos(angle) * distance,
        y: center + Math.sin(angle) * distance,
        labelX: center + Math.cos(angle) * (radius + 24),
        labelY: center + Math.sin(angle) * (radius + 24),
      };
    });

  return (
    <div className="glass-panel rounded-[28px] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-violet-200">Subject Radar</p>
          <p className="text-xs text-zinc-400">Performance spread across current semester</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
          {data.length} subjects
        </span>
      </div>

      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[21rem] overflow-visible">
        <defs>
          <linearGradient id="radarFill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(192,132,252,0.55)" />
            <stop offset="100%" stopColor="rgba(139,92,246,0.15)" />
          </linearGradient>
        </defs>

        {levels.map((level) => (
          <polygon
            key={level}
            points={buildPolygon(level / 100)}
            fill="none"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth="1"
          />
        ))}

        {points.map((point) => (
          <line
            key={point.code}
            x1={center}
            y1={center}
            x2={point.labelX - (point.labelX - center) * 0.12}
            y2={point.labelY - (point.labelY - center) * 0.12}
            stroke="rgba(255,255,255,0.08)"
          />
        ))}

        <polygon
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="url(#radarFill)"
          stroke="rgba(196,181,253,0.95)"
          strokeWidth="2"
        />

        {points.map((point) => (
          <g key={`${point.code}-dot`}>
            <circle cx={point.x} cy={point.y} r="4" fill="#f5f3ff" />
            <text
              x={point.labelX}
              y={point.labelY}
              fill="rgba(228,228,231,0.95)"
              fontSize="11"
              textAnchor={point.labelX < center - 20 ? "end" : point.labelX > center + 20 ? "start" : "middle"}
            >
              {point.code}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default RadarChart;
