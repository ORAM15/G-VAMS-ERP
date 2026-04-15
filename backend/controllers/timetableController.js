const Timetable = require("../models/Timetable");
const User = require("../models/User");
const { DAY_NAMES, buildTimetableForSection } = require("../utils/erpData");

const getCurrentDayName = () => DAY_NAMES[new Date().getDay() - 1] || "Mon";

exports.getTimetable = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "studentId name semester section className"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let timetable = await Timetable.findOne({
      semester: user.semester,
      section: user.section,
    });

    if (!timetable) {
      timetable = await Timetable.create(
        buildTimetableForSection(user.semester, user.section)
      );
    }

    const today = getCurrentDayName();
    const todaySchedule =
      timetable.week.find((entry) => entry.day === today) || timetable.week[0];
    const todayClasses = (todaySchedule ? todaySchedule.classes : []).map((item) => ({
      subject: item.subject,
      teacher: item.teacher,
      time: item.time,
      room: item.room,
      type: item.tag,
    }));

    return res.status(200).json({
      today,
      todayName: today,
      todayClasses,
      dateLabel: new Date().toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
      student: {
        studentId: user.studentId,
        name: user.name,
        semester: user.semester,
        className: user.className,
        section: user.section,
      },
      week: timetable.week,
      todaySchedule: todaySchedule ? todaySchedule.classes : [],
    });
  } catch (error) {
    console.error("Timetable fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch timetable" });
  }
};
