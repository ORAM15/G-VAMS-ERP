const express = require("express");
const { getTimetable } = require("../controllers/timetableController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getTimetable);

module.exports = router;
