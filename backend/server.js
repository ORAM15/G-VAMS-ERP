const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// routes
const authRoutes = require("./routes/authRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const performanceRoutes = require("./routes/performanceRoutes");
const timetableRoutes = require("./routes/timetableRoutes");
const lmsRoutes = require("./routes/lmsRoutes");
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/timetable", timetableRoutes);
app.use("/api/lms", lmsRoutes);

// DB connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// test route
app.get("/", (req, res) => {
  res.send("API working");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
