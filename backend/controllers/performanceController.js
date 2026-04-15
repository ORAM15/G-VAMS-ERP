const Performance = require("../models/Performance");
const User = require("../models/User");
const { buildPerformanceForStudent } = require("../utils/erpData");

const getPerformanceRecord = async (userId) => {
  const user = await User.findById(userId).select(
    "studentId semester className section cgpa department name"
  );

  if (!user) {
    return null;
  }

  let performance = await Performance.findOne({ studentId: user.studentId });

  if (!performance) {
    performance = await Performance.create(buildPerformanceForStudent(user));
  }

  return { user, performance };
};

exports.getPerformance = async (req, res) => {
  try {
    const record = await getPerformanceRecord(req.user._id);

    if (!record) {
      return res.status(404).json({ message: "User not found" });
    }

    const { user, performance } = record;

    return res.status(200).json({
      student: {
        name: user.name,
        studentId: user.studentId,
        semester: user.semester,
        className: user.className,
        section: user.section,
        cgpa: user.cgpa,
        department: user.department,
      },
      average: performance.averagePercentage,
      averagePercentage: performance.averagePercentage,
      radar: performance.subjects.map((subject) => ({
        subject: subject.name,
        code: subject.code,
        percentage: subject.percentage,
      })),
      subjects: performance.subjects.map((subject) => ({
        ...subject.toObject(),
        exams: subject.examCount,
      })),
    });
  } catch (error) {
    console.error("Performance fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch performance" });
  }
};
