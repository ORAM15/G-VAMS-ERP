const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    subjectCode: { type: String, required: true, trim: true },
    teacher: { type: String, required: true, trim: true },
    room: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },
    tag: { type: String, enum: ["Lecture", "Practical"], required: true },
  },
  { _id: false }
);

const timetableDaySchema = new mongoose.Schema(
  {
    day: { type: String, required: true, trim: true },
    classes: [classSchema],
  },
  { _id: false }
);

const timetableSchema = new mongoose.Schema(
  {
    semester: { type: Number, required: true },
    section: { type: String, required: true, trim: true },
    week: [timetableDaySchema],
  },
  { timestamps: true }
);

timetableSchema.index({ semester: 1, section: 1 }, { unique: true });

module.exports = mongoose.model("Timetable", timetableSchema);
