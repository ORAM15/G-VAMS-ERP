const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { buildAttendanceForStudent } = require("../utils/erpData");

const defaultSubjects = [
  { name: "Software Eng.", totalClasses: 26, presentClasses: 24, percentage: 92 },
  { name: "Digital Design", totalClasses: 27, presentClasses: 20, percentage: 74 },
  { name: "Applied Math", totalClasses: 25, presentClasses: 22, percentage: 88 },
  { name: "Circuit Analysis", totalClasses: 22, presentClasses: 18, percentage: 81 },
];

const calculatePercentage = (presentClasses, totalClasses) => {
  if (!totalClasses) {
    return 0;
  }

  return Math.round((presentClasses / totalClasses) * 100);
};

const buildAttendanceEntries = (attendance) => {
  const entries = [];

  attendance.subjects.forEach((subject) => {
    const totalClasses = subject.totalClasses || 0;
    const presentClasses = subject.presentClasses || 0;

    for (let index = 0; index < totalClasses; index += 1) {
      const classDate = new Date();
      classDate.setDate(classDate.getDate() - entries.length - 1);

      entries.push({
        subject: subject.name,
        status: index < presentClasses ? "present" : "absent",
        date: classDate,
      });
    }
  });

  return entries.sort((left, right) => new Date(right.date) - new Date(left.date));
};

const normalizeSubject = (subject) => {
  const normalizedSubject = subject.toObject ? subject.toObject() : { ...subject };

  if (!normalizedSubject.totalClasses) {
    normalizedSubject.totalClasses = 30;
  }

  if (
    normalizedSubject.presentClasses === undefined ||
    normalizedSubject.presentClasses === null
  ) {
    normalizedSubject.presentClasses = Math.round(
      (normalizedSubject.percentage / 100) * normalizedSubject.totalClasses
    );
  }

  normalizedSubject.percentage = calculatePercentage(
    normalizedSubject.presentClasses,
    normalizedSubject.totalClasses
  );
  normalizedSubject.leavesRemaining =
    normalizedSubject.leavesRemaining ?? Math.max(
      Math.floor(normalizedSubject.presentClasses / 0.75 - normalizedSubject.totalClasses),
      0
    );
  normalizedSubject.statusMessage =
    normalizedSubject.statusMessage ||
    (normalizedSubject.percentage >= 75
      ? `Safe to miss ${normalizedSubject.leavesRemaining} classes`
      : "Attend to recover");

  return normalizedSubject;
};

const ensureAttendanceConsistency = async (attendance) => {
  let shouldSave = false;

  if (!attendance.subjects || attendance.subjects.length === 0) {
    attendance.subjects = defaultSubjects;
    shouldSave = true;
  }

  const normalizedSubjects = attendance.subjects.map((subject) => normalizeSubject(subject));
  const derivedTotalClasses = normalizedSubjects.reduce(
    (sum, subject) => sum + subject.totalClasses,
    0
  );
  const derivedPresentClasses = normalizedSubjects.reduce(
    (sum, subject) => sum + subject.presentClasses,
    0
  );

  attendance.subjects = normalizedSubjects;

  if (!attendance.totalClasses) {
    attendance.totalClasses = derivedTotalClasses;
    shouldSave = true;
  }

  if (attendance.presentClasses === undefined || attendance.presentClasses === null) {
    attendance.presentClasses = derivedPresentClasses;
    shouldSave = true;
  }

  attendance.overallPercentage = calculatePercentage(
    attendance.presentClasses,
    attendance.totalClasses
  );

  if (!attendance.projectedBase) {
    attendance.projectedBase = Math.max(attendance.overallPercentage - 3, 0);
    shouldSave = true;
  }

  if (shouldSave) {
    await attendance.save();
  }

  return attendance;
};

const getAttendanceRecord = async (userId) => {
  const user = await User.findById(userId).select(
    "studentId semester className section cgpa department name"
  );

  if (!user) {
    return null;
  }

  let attendance = await Attendance.findOne({ studentId: user.studentId });

  if (!attendance) {
    attendance = await Attendance.create(buildAttendanceForStudent(user));
  }

  const normalizedAttendance = await ensureAttendanceConsistency(attendance);
  return { user, attendance: normalizedAttendance };
};

exports.getAttendance = async (req, res) => {
  try {
    const record = await getAttendanceRecord(req.user._id);

    if (!record) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(buildAttendanceEntries(record.attendance));
  } catch (error) {
    console.error("Attendance fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch attendance" });
  }
};

exports.getAttendanceStats = async (req, res) => {
  try {
    const record = await getAttendanceRecord(req.user._id);

    if (!record) {
      return res.status(404).json({ message: "User not found" });
    }

    const { user, attendance } = record;

    return res.status(200).json({
      total: attendance.totalClasses,
      present: attendance.presentClasses,
      percentage: attendance.overallPercentage,
      absent: attendance.totalClasses - attendance.presentClasses,
      requirement: attendance.requirementPercentage,
      student: {
        name: user.name,
        studentId: user.studentId,
        semester: user.semester,
        className: user.className,
        section: user.section,
        cgpa: user.cgpa,
        department: user.department,
      },
    });
  } catch (error) {
    console.error("Attendance stats fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch attendance stats" });
  }
};

exports.getAttendanceSubjects = async (req, res) => {
  try {
    const record = await getAttendanceRecord(req.user._id);

    if (!record) {
      return res.status(404).json({ message: "User not found" });
    }

    const { attendance } = record;

    return res.status(200).json(
      attendance.subjects.map((subject) => ({
        subject: subject.name,
        code: subject.code,
        credits: subject.credits,
        teacher: subject.teacher,
        totalClasses: subject.totalClasses,
        presentClasses: subject.presentClasses,
        percentage: subject.percentage,
        leavesRemaining: subject.leavesRemaining,
        statusMessage: subject.statusMessage,
      }))
    );
  } catch (error) {
    console.error("Attendance subjects fetch failed:", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch subject attendance" });
  }
};
