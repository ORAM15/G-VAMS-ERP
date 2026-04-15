const Leave = require("../models/Leave");
const User = require("../models/User");

const getCurrentUser = async (userId) =>
  User.findById(userId).select("studentId");

exports.getLeaves = async (req, res) => {
  try {
    const user = await getCurrentUser(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const leaves = await Leave.find({ studentId: user.studentId }).sort({
      createdAt: -1,
    });

    return res.status(200).json(leaves);
  } catch (error) {
    console.error("Leave fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch leave history" });
  }
};

exports.createLeave = async (req, res) => {
  try {
    const { startDate, duration, reason, description } = req.body;

    if (!startDate || !duration || !reason) {
      return res.status(400).json({
        message: "Start date, duration, and reason are required",
      });
    }

    const user = await getCurrentUser(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const leave = await Leave.create({
      studentId: user.studentId,
      startDate,
      duration: Number(duration),
      reason,
      description: description || "",
    });

    return res.status(201).json(leave);
  } catch (error) {
    console.error("Leave creation failed:", error);
    return res.status(500).json({ message: "Failed to submit leave request" });
  }
};
