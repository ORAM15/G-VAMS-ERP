const express = require("express");
const { getLeaves, createLeave } = require("../controllers/leaveController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getLeaves);
router.post("/", protect, createLeave);

module.exports = router;
