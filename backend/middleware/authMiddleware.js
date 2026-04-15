const jwt = require("jsonwebtoken");

const getJwtSecret = () => process.env.JWT_SECRET || "g-vams-dev-secret";

exports.protect = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : "";

  console.debug("[auth/validate] token received:", token || null);

  if (!authHeader.startsWith("Bearer ")) {
    console.debug("[auth/validate] failure reason: no token provided");
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    console.debug("[auth/validate] decode result:", decoded);
    req.user = {
      ...decoded,
      _id: decoded.userId,
    };
    next();
  } catch (error) {
    console.debug("[auth/validate] failure reason:", error.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};
