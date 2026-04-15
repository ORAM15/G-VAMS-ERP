import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/gndec.png";
import { apiRequest } from "../utils/api";

function Login({ authReady, onLoginSuccess }) {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authReady) {
      setLoading(true);
      return;
    }

    setLoading(false);
  }, [authReady]);

  const handleLogin = async () => {
    if (!id.trim() || !password) {
      alert("Enter your student ID and password.");
      return;
    }

    setLoading(true);

    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ id: id.trim(), password }),
      });

      onLoginSuccess(data);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      alert(error.message || "Server error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-black via-purple-900 to-black">
      <img
        src={logo}
        alt="GNDEC Logo"
        className="w-36 mb-4 drop-shadow-[0_0_15px_rgba(168,85,247,0.7)]"
      />

      <h1 className="text-white text-xl md:text-2xl font-semibold mb-6 text-center">
        Welcome Back To G-VAMS
      </h1>

      <div className="bg-gray-900/70 backdrop-blur-xl border border-purple-500/20 p-8 rounded-2xl w-80 shadow-xl">
        <input
          type="text"
          placeholder="Student ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="w-full mb-4 p-3 rounded bg-black text-white border border-gray-700 focus:outline-none focus:border-purple-500"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-6 p-3 rounded bg-black text-white border border-gray-700 focus:outline-none focus:border-purple-500"
        />

        <button
          type="button"
          onClick={handleLogin}
          disabled={loading || !authReady}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-lg transition duration-300 disabled:opacity-70"
        >
          {loading ? "Signing in..." : "Login"}
        </button>
      </div>
    </div>
  );
}

export default Login;
