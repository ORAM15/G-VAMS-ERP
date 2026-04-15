const mongoose = require("mongoose");

const markSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const performanceSubjectSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    examCount: { type: Number, required: true },
    percentage: { type: Number, required: true },
    marks: [markSchema],
  },
  { _id: false }
);

const performanceSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, trim: true, unique: true },
    semester: { type: Number, required: true },
    averagePercentage: { type: Number, required: true },
    subjects: [performanceSubjectSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Performance", performanceSchema);
