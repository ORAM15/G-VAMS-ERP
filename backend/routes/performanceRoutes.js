const express = require("express");
const { getPerformance } = require("../controllers/performanceController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getPerformance);

module.exports = router;
