const express = require("express");
const {
  getAttendance,
  getAttendanceStats,
  getAttendanceSubjects,
} = require("../controllers/attendanceController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/stats", protect, getAttendanceStats);
router.get("/subjects", protect, getAttendanceSubjects);
router.get("/", protect, getAttendance);

module.exports = router;
