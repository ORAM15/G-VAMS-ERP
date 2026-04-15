const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    semester: {
      type: Number,
      min: 1,
      max: 6,
      default: 1,
    },
    className: {
      type: String,
      trim: true,
      default: "A",
    },
    section: {
      type: String,
      trim: true,
      default: "A1",
    },
    cgpa: {
      type: Number,
      default: 7.5,
    },
    department: {
      type: String,
      trim: true,
      default: "Computer Science and Engineering",
    },
    password: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
