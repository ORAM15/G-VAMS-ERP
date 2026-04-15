require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const Attendance = require("./models/Attendance");
const Leave = require("./models/Leave");
const Performance = require("./models/Performance");
const Timetable = require("./models/Timetable");
const LmsMaterial = require("./models/LmsMaterial");
const {
  getStudentProfile,
  buildAttendanceForStudent,
  buildPerformanceForStudent,
  buildTimetables,
  buildLmsMaterials,
  buildLeavesForStudent,
} = require("./utils/erpData");

const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB Connected for Seeding");
};

const clearCollections = async () => {
  await User.deleteMany();
  await Attendance.deleteMany();
  await Leave.deleteMany();
  await Performance.deleteMany();
  await Timetable.deleteMany();
  await LmsMaterial.deleteMany();
};

const seedData = async () => {
  try {
    console.log("Clearing old data...");
    await clearCollections();

    console.log("Seeding 1000 students...");
    const hashedPassword = await bcrypt.hash("123456", 10);
    const users = [];

    for (let index = 1; index <= 1000; index += 1) {
      const profile = getStudentProfile(index);
      const user = await User.create({
        name: profile.name,
        studentId: profile.studentId,
        semester: profile.semester,
        className: profile.className,
        section: profile.section,
        cgpa: profile.cgpa,
        department: profile.department,
        password: hashedPassword,
      });

      users.push(user);
    }

    console.log("Seeding attendance analytics...");
    await Attendance.insertMany(users.map((user) => buildAttendanceForStudent(user)));

    console.log("Seeding performance records...");
    await Performance.insertMany(users.map((user) => buildPerformanceForStudent(user)));

    console.log("Seeding section timetables...");
    await Timetable.insertMany(buildTimetables());

    console.log("Seeding LMS materials...");
    await LmsMaterial.insertMany(buildLmsMaterials());

    console.log("Seeding leave requests...");
    await Leave.insertMany(users.flatMap((user) => buildLeavesForStudent(user)));

    console.log("Seeding completed successfully");
    console.log("Login:");
    console.log("Student ID: GVAMS1001");
    console.log("Password: 123456");

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

connectDB().then(seedData);
