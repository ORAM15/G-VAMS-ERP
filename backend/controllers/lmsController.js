const LmsMaterial = require("../models/LmsMaterial");
const { buildLmsMaterials } = require("../utils/erpData");

const ensureSeededMaterials = async () => {
  const count = await LmsMaterial.countDocuments();

  if (count === 0) {
    await LmsMaterial.insertMany(buildLmsMaterials());
  }
};

exports.getLmsIndex = async (req, res) => {
  try {
    await ensureSeededMaterials();

    const subjects = await LmsMaterial.find({})
      .select("name code semester")
      .sort({ semester: 1, code: 1 })
      .limit(12);

    return res.status(200).json({
      subjects,
    });
  } catch (error) {
    console.error("LMS index fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch LMS resources" });
  }
};

exports.getLmsResource = async (req, res) => {
  try {
    await ensureSeededMaterials();

    const { resource } = req.params;

    if (/^\d+$/.test(resource)) {
      const semester = Number(resource);
      const subjects = await LmsMaterial.find({ semester })
        .select("semester code name credits teacher")
        .sort({ code: 1 });

      return res.status(200).json({
        semester,
        subjects: subjects.map((subject) => ({
          name: subject.name,
          code: subject.code,
          credits: subject.credits,
          teacher: subject.teacher,
          semester: subject.semester,
        })),
      });
    }

    const subject = await LmsMaterial.findOne({
      code: resource.toUpperCase(),
    }).select("-createdAt -updatedAt -__v");

    if (!subject) {
      return res.status(404).json({ message: "LMS subject not found" });
    }

    return res.status(200).json({
      ...subject.toObject(),
      syllabus: subject.syllabus || "Unit 1...",
      notes: subject.notes || [],
      assignments: subject.assignments || [],
      noteLinks: (subject.notes || []).map((item) => item.url || item),
      assignmentTitles: (subject.assignments || []).map((item) => item.title || item),
    });
  } catch (error) {
    console.error("LMS fetch failed:", error);
    return res.status(500).json({ message: "Failed to fetch LMS resources" });
  }
};
