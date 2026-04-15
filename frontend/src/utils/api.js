const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000/api";

export const apiRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem("gvams_token");

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(options.headers || {}),
      },
      body: options.body,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "API Error");
    }

    return data;
  } catch (error) {
    console.error("API ERROR:", error);
    throw new Error("Failed to fetch");
  }
};