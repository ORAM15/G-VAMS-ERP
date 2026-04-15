const express = require("express");
const { getLmsIndex, getLmsResource } = require("../controllers/lmsController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getLmsIndex);
router.get("/:resource", protect, getLmsResource);

module.exports = router;
