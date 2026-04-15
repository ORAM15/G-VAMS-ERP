const mongoose = require("mongoose");

const linkSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const assignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    dueDate: { type: String, required: true, trim: true },
    status: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const materialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const lmsMaterialSchema = new mongoose.Schema(
  {
    semester: { type: Number, required: true },
    code: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    credits: { type: Number, required: true },
    teacher: { type: String, required: true, trim: true },
    syllabus: { type: String, required: true, trim: true },
    notes: [linkSchema],
    assignments: [assignmentSchema],
    courseMaterials: [materialSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("LmsMaterial", lmsMaterialSchema);
