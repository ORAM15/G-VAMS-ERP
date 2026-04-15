const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_SLOTS = [
  "08:30 - 09:20",
  "09:25 - 10:15",
  "10:30 - 11:20",
  "11:25 - 12:15",
  "13:00 - 13:50",
  "13:55 - 14:45",
];

const SEMESTER_SUBJECTS = {
  1: [
    { code: "BAS101", name: "Applied Mathematics I", credits: 4, teacher: "Dr. Anika Verma", practical: false },
    { code: "BAS102", name: "Engineering Physics", credits: 4, teacher: "Prof. Kabir Malhotra", practical: true },
    { code: "ESC101", name: "Programming Fundamentals", credits: 3, teacher: "Prof. Riya Nanda", practical: true },
    { code: "ESC102", name: "Basic Electrical Engineering", credits: 3, teacher: "Dr. Naman Sethi", practical: true },
    { code: "HSM101", name: "Professional Communication", credits: 2, teacher: "Prof. Meera Kapoor", practical: false },
    { code: "MEC101", name: "Engineering Graphics", credits: 3, teacher: "Prof. Aarav Chawla", practical: true },
  ],
  2: [
    { code: "BAS201", name: "Applied Mathematics II", credits: 4, teacher: "Dr. Tanya Gill", practical: false },
    { code: "ESC201", name: "Data Structures", credits: 4, teacher: "Prof. Arjun Bedi", practical: true },
    { code: "ESC202", name: "Digital Logic Design", credits: 3, teacher: "Dr. Karan Sood", practical: true },
    { code: "ESC203", name: "Engineering Chemistry", credits: 3, teacher: "Prof. Ira Bansal", practical: true },
    { code: "HSM201", name: "Environmental Studies", credits: 2, teacher: "Prof. Noor Ahuja", practical: false },
    { code: "MEC201", name: "Workshop Practice", credits: 2, teacher: "Prof. Yash Kohli", practical: true },
  ],
  3: [
    { code: "CSE301", name: "Object Oriented Programming", credits: 4, teacher: "Dr. Simran Oberoi", practical: true },
    { code: "CSE302", name: "Discrete Mathematics", credits: 4, teacher: "Prof. Ronit Arora", practical: false },
    { code: "CSE303", name: "Computer Organization", credits: 3, teacher: "Dr. Neha Walia", practical: true },
    { code: "CSE304", name: "Database Systems", credits: 4, teacher: "Prof. Vanya Gupta", practical: true },
    { code: "CSE305", name: "Probability and Statistics", credits: 3, teacher: "Dr. Raghav Dua", practical: false },
    { code: "CSE306", name: "Design Thinking", credits: 2, teacher: "Prof. Zoya Anand", practical: false },
  ],
  4: [
    { code: "CSE401", name: "Operating Systems", credits: 4, teacher: "Dr. Piyush Khanna", practical: true },
    { code: "CSE402", name: "Analysis of Algorithms", credits: 4, teacher: "Prof. Kriti Bedi", practical: false },
    { code: "CSE403", name: "Software Engineering", credits: 3, teacher: "Dr. Harsh Vaid", practical: false },
    { code: "CSE404", name: "Microprocessors", credits: 3, teacher: "Prof. Lavanya Saini", practical: true },
    { code: "CSE405", name: "Theory of Computation", credits: 4, teacher: "Dr. Parth Sharma", practical: false },
    { code: "CSE406", name: "Open Source Lab", credits: 2, teacher: "Prof. Niharika Joshi", practical: true },
  ],
  5: [
    { code: "CSE501", name: "Computer Networks", credits: 4, teacher: "Dr. Aditi Bhardwaj", practical: true },
    { code: "CSE502", name: "Compiler Design", credits: 4, teacher: "Prof. Ishaan Puri", practical: false },
    { code: "CSE503", name: "Artificial Intelligence", credits: 4, teacher: "Dr. Mitali Goel", practical: true },
    { code: "CSE504", name: "Web Engineering", credits: 3, teacher: "Prof. Sahil Dhawan", practical: true },
    { code: "CSE505", name: "Data Analytics", credits: 3, teacher: "Prof. Trisha Narang", practical: true },
    { code: "CSE506", name: "Elective I", credits: 3, teacher: "Dr. Vivek Saran", practical: false },
  ],
  6: [
    { code: "CSE601", name: "Machine Learning", credits: 4, teacher: "Dr. Kiara Mehta", practical: true },
    { code: "CSE602", name: "Cloud Computing", credits: 4, teacher: "Prof. Dev Malhotra", practical: true },
    { code: "CSE603", name: "Cyber Security", credits: 4, teacher: "Dr. Ruhi Bhatia", practical: true },
    { code: "CSE604", name: "Mobile App Development", credits: 3, teacher: "Prof. Nitin Bawa", practical: true },
    { code: "CSE605", name: "Project Management", credits: 3, teacher: "Prof. Isha Bajaj", practical: false },
    { code: "CSE606", name: "Elective II", credits: 3, teacher: "Dr. Aman Guleria", practical: false },
  ],
};

const NOTE_LABELS = ["Lecture Notes", "Module Summary", "Revision Deck"];
const MATERIAL_LABELS = ["Course Outline", "Lab Manual", "Reading Pack"];

const hashString = (value) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const valueInRange = (seed, min, max) => min + (seed % (max - min + 1));

const roundToOne = (value) => Math.round(value * 10) / 10;

const percentage = (presentClasses, totalClasses) => {
  if (!totalClasses) {
    return 0;
  }

  return Math.round((presentClasses / totalClasses) * 100);
};

const getSafeToMissCount = (presentClasses, totalClasses) => {
  const remaining = Math.floor(presentClasses / 0.75 - totalClasses);
  return Math.max(remaining, 0);
};

const getClassesToRecover = (presentClasses, totalClasses) => {
  let extraClasses = 0;

  while (percentage(presentClasses + extraClasses, totalClasses + extraClasses) < 75) {
    extraClasses += 1;
  }

  return extraClasses;
};

const getStudentProfile = (index) => {
  const semester = ((index - 1) % 6) + 1;
  const className = Math.floor((index - 1) / 4) % 2 === 0 ? "A" : "B";
  const sectionList = className === "A" ? ["A1", "A2"] : ["B1", "B2"];
  const section = sectionList[Math.floor((index - 1) / 2) % 2];
  const studentId = `GVAMS${String(1000 + index).padStart(4, "0")}`;
  const profileSeed = hashString(studentId);

  return {
    studentId,
    name: `Student ${index}`,
    semester,
    className,
    section,
    password: "123456",
    cgpa: roundToOne(6.4 + (profileSeed % 27) / 10),
    department: "Computer Science and Engineering",
  };
};

const getSubjectsForSemester = (semester) => SEMESTER_SUBJECTS[semester] || [];

const buildAttendanceForStudent = (student) => {
  const baseSeed = hashString(student.studentId);
  const subjects = getSubjectsForSemester(student.semester).map((subject, subjectIndex) => {
    const subjectSeed = baseSeed + hashString(subject.code) + subjectIndex * 97;
    const totalClasses = valueInRange(subjectSeed, 28, 46);
    const percentValue = valueInRange(subjectSeed >> 1, 66, 96);
    const presentClasses = Math.max(
      0,
      Math.min(totalClasses, Math.round((percentValue / 100) * totalClasses))
    );
    const currentPercentage = percentage(presentClasses, totalClasses);
    const leavesRemaining = currentPercentage >= 75
      ? getSafeToMissCount(presentClasses, totalClasses)
      : 0;
    const classesToRecover = currentPercentage < 75
      ? getClassesToRecover(presentClasses, totalClasses)
      : 0;

    return {
      name: subject.name,
      code: subject.code,
      credits: subject.credits,
      teacher: subject.teacher,
      totalClasses,
      presentClasses,
      percentage: currentPercentage,
      leavesRemaining,
      statusMessage:
        currentPercentage >= 75
          ? `Safe to miss ${leavesRemaining} classes`
          : `Attend ${classesToRecover} classes to recover`,
    };
  });

  const totalClasses = subjects.reduce((sum, subject) => sum + subject.totalClasses, 0);
  const presentClasses = subjects.reduce((sum, subject) => sum + subject.presentClasses, 0);
  const overallPercentage = percentage(presentClasses, totalClasses);

  return {
    studentId: student.studentId,
    totalClasses,
    presentClasses,
    overallPercentage,
    requirementPercentage: 75,
    projectedBase: Math.max(overallPercentage - 2, 0),
    subjects,
  };
};

const buildPerformanceForStudent = (student) => {
  const baseSeed = hashString(`${student.studentId}-performance`);
  const subjects = getSubjectsForSemester(student.semester).map((subject, subjectIndex) => {
    const subjectSeed = baseSeed + hashString(subject.code) + subjectIndex * 67;
    const examTemplates = [
      { title: "Quiz", total: 20 },
      { title: "Assignment", total: 30 },
      { title: "Mid Sem", total: 50 },
      { title: "End Sem", total: 100 },
    ];

    const marks = examTemplates.map((exam, examIndex) => {
      const markSeed = subjectSeed + examIndex * 13;
      const minimumRatio = exam.title === "End Sem" ? 0.58 : 0.65;
      const ratio = minimumRatio + ((markSeed % 25) / 100);

      return {
        title: exam.title,
        score: Math.round(exam.total * Math.min(ratio, 0.95)),
        total: exam.total,
      };
    });

    const scored = marks.reduce((sum, exam) => sum + exam.score, 0);
    const total = marks.reduce((sum, exam) => sum + exam.total, 0);

    return {
      code: subject.code,
      name: subject.name,
      examCount: marks.length,
      percentage: percentage(scored, total),
      marks,
    };
  });

  return {
    studentId: student.studentId,
    semester: student.semester,
    averagePercentage: Math.round(
      subjects.reduce((sum, subject) => sum + subject.percentage, 0) / subjects.length
    ),
    subjects,
  };
};

const buildWeekForSection = (semester, section) => {
  const subjects = getSubjectsForSemester(semester);
  const offset = hashString(`${semester}-${section}`) % subjects.length;

  return DAY_NAMES.map((day, dayIndex) => {
    const totalClasses = day === "Sat" ? 4 : 6;
    const classes = Array.from({ length: totalClasses }, (_, slotIndex) => {
      const subject = subjects[(offset + dayIndex + slotIndex) % subjects.length];
      const practicalSlot = subject.practical && slotIndex >= 3 && slotIndex % 2 === 1;

      return {
        subject: subject.name,
        subjectCode: subject.code,
        teacher: subject.teacher,
        room: practicalSlot ? `Lab-${valueInRange(hashString(subject.code), 201, 309)}` : `Room-${valueInRange(hashString(section), 101, 205)}`,
        time: TIME_SLOTS[slotIndex],
        tag: practicalSlot ? "Practical" : "Lecture",
      };
    });

    return { day, classes };
  });
};

const buildTimetableForSection = (semester, section) => ({
  semester,
  section,
  week: buildWeekForSection(semester, section),
});

const buildTimetables = () => {
  const sections = ["A1", "A2", "B1", "B2"];
  const docs = [];

  for (let semester = 1; semester <= 6; semester += 1) {
    sections.forEach((section) => {
      docs.push(buildTimetableForSection(semester, section));
    });
  }

  return docs;
};

const buildLmsMaterials = () => {
  const docs = [];

  for (let semester = 1; semester <= 6; semester += 1) {
    getSubjectsForSemester(semester).forEach((subject, index) => {
      docs.push({
        semester,
        code: subject.code,
        name: subject.name,
        credits: subject.credits,
        teacher: subject.teacher,
        syllabus: `${subject.name} covers core semester ${semester} concepts, tutorials, practical problem solving, and exam-oriented revision modules aligned to the ERP curriculum.`,
        notes: NOTE_LABELS.map((label, noteIndex) => ({
          title: `${label} ${noteIndex + 1}`,
          url: `https://example.com/lms/${subject.code.toLowerCase()}/notes-${noteIndex + 1}.pdf`,
        })),
        assignments: [
          {
            title: `${subject.name} Assignment 1`,
            dueDate: `2026-0${((semester + index) % 9) + 1}-12`,
            status: "Open",
          },
          {
            title: `${subject.name} Assignment 2`,
            dueDate: `2026-0${((semester + index + 1) % 9) + 1}-24`,
            status: "Upcoming",
          },
        ],
        courseMaterials: MATERIAL_LABELS.map((label, materialIndex) => ({
          title: `${label} ${materialIndex + 1}`,
          description: `${subject.name} resource pack ${materialIndex + 1} for quick revisions and guided practice.`,
        })),
      });
    });
  }

  return docs;
};

const buildLeavesForStudent = (student) => {
  const reasons = ["Medical", "Personal", "Family", "Academic"];
  const statuses = ["Pending", "Approved", "Rejected"];
  const seed = hashString(`${student.studentId}-leave`);
  const count = valueInRange(seed, 1, 3);

  return Array.from({ length: count }, (_, index) => ({
    studentId: student.studentId,
    reason: reasons[(seed + index) % reasons.length],
    startDate: new Date(2026, (seed + index) % 6, 5 + index * 4),
    duration: valueInRange(seed + index * 9, 1, 4),
    description: "Auto generated ERP leave request",
    status: statuses[(seed + index) % statuses.length],
  }));
};

module.exports = {
  DAY_NAMES,
  getStudentProfile,
  getSubjectsForSemester,
  buildAttendanceForStudent,
  buildPerformanceForStudent,
  buildTimetableForSection,
  buildTimetables,
  buildLmsMaterials,
  buildLeavesForStudent,
};
