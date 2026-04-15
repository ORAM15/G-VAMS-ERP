const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const { login, validateSession } = require("../controllers/authController");

router.post("/login", login);
router.get("/validate", protect, validateSession);

module.exports = router;
