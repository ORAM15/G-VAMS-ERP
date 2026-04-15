const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const getJwtSecret = () => process.env.JWT_SECRET || "g-vams-dev-secret";

const comparePassword = async (plainPassword, storedPassword) => {
  if (!storedPassword) {
    return false;
  }

  if (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$")) {
    return bcrypt.compare(plainPassword, storedPassword);
  }

  return plainPassword === storedPassword;
};

exports.login = async (req, res) => {
  try {
    const { id, password } = req.body;

    if (!id || !password) {
      return res.status(400).json({
        message: "Student ID and password are required",
      });
    }

    const normalizedId = id.trim();
    const user = await User.findOne({ studentId: normalizedId });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        studentId: user.studentId,
        name: user.name || user.studentId,
      },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login success",
      token,
      user: {
        id: user._id,
        studentId: user.studentId,
        name: user.name || user.studentId,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

exports.validateSession = async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : "";
    console.debug("[auth/validate] token received:", token || null);

    if (!token) {
      console.debug("[auth/validate] failure reason: no token provided");
      return res.status(401).json({
        message: "No token provided",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, getJwtSecret());
      console.debug("[auth/validate] decode result:", decoded);
    } catch (error) {
      console.debug("[auth/validate] failure reason:", error.message);
      return res.status(401).json({
        message: "Invalid token",
      });
    }

    const user = await User.findById(decoded.userId).select("_id studentId name");

    if (!user) {
      console.debug("[auth/validate] failure reason: user not found");
      return res.status(401).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      user: {
        id: user._id,
        studentId: user.studentId,
        name: user.name || user.studentId,
      },
    });
  } catch (error) {
    console.error("Session validation failed:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
