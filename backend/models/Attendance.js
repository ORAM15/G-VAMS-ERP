const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    overallPercentage: {
      type: Number,
      default: 85,
    },
    requirementPercentage: {
      type: Number,
      default: 75,
    },
    projectedBase: {
      type: Number,
      default: 82,
    },
    totalClasses: {
      type: Number,
      default: 120,
    },
    presentClasses: {
      type: Number,
      default: 102,
    },
    subjects: [
      {
        name: { type: String, required: true, trim: true },
        code: { type: String, trim: true, default: "" },
        credits: { type: Number, default: 0 },
        teacher: { type: String, trim: true, default: "" },
        totalClasses: { type: Number, default: 30 },
        presentClasses: { type: Number, default: 25 },
        percentage: { type: Number, required: true },
        leavesRemaining: { type: Number, default: 0 },
        statusMessage: { type: String, trim: true, default: "" },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
