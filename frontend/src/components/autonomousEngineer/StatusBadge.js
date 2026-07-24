import { TONE_CLASSES } from "../../utils/autonomousEngineer";

/**
 * A small rounded-pill label used throughout the Autonomous Engineer Dashboard for criticality, risk,
 * impact, complexity, and detection-status indicators.
 */
function StatusBadge({ label, tone = "slate" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASSES[tone] || TONE_CLASSES.slate}`}>
      {label}
    </span>
  );
}

export default StatusBadge;
