require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3001;

// ==============================
// ENV CONFIG
// ==============================
const JWT_SECRET = process.env.JWT_SECRET || "secret123"; // ✅ fallback

console.log("JWT_SECRET:", JWT_SECRET); // 🔥 DEBUG

// ==============================
// SUPABASE INIT
// ==============================
const supabase = createClient(
  "https://odswgsvccutgwwnoappf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kc3dnc3ZjY3V0Z3d3bm9hcHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDM5NzIsImV4cCI6MjA4NzMxOTk3Mn0.4wNjBNqIqK4HUvWFu0Z5GejpvLsqTeLrXZwBbpuCtkg"
);

// ==============================
// ROLE NORMALIZER
// ==============================
const normalizeRole = (role) => {
  if (!role) return "Employee";

  const r = role.toLowerCase();

  if (r.includes("manager")) return "Manager";
  if (r.includes("lead")) return "Team Lead";

  return "Employee";
};

// ==============================
// JWT MIDDLEWARE
// ==============================
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token provided" });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    const token = authHeader.split(" ")[1];

    const user = jwt.verify(token, JWT_SECRET);

    req.user = user;
    next();

  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    return res.status(403).json({ error: "Invalid token" });
  }
};

// ==============================
// LOGIN
// ==============================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    const { data: users, error } = await supabase
      .from("Email")
      .select("*")
      .eq("email", cleanEmail);

    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = users[0];

    if (String(user.password).trim() !== String(password).trim()) {
      return res.status(401).json({ error: "Wrong password" });
    }

    const { data: emp, error: empError } = await supabase
      .from("employees")
      .select("*")
      .eq("id", user.id)
      .single();

    if (empError) throw empError;

    const payload = {
      id: emp.id,
      name: emp.name,
      role: normalizeRole(emp.role),
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ token, user: payload });

  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// APPLY LEAVE
// ==============================
app.post("/api/leaves", authMiddleware, async (req, res) => {
  try {
    const { from_date, to_date, reason } = req.body;

    if (!from_date || !to_date || !reason) {
      return res.status(400).json({ error: "All fields required" });
    }

    const { data, error } = await supabase
      .from("leaves")
      .insert([
        {
          employee_id: req.user.id,
          from_date,
          to_date,
          reason,
          status: "PENDING",
        },
      ])
      .select();

    if (error) {
      console.error("SUPABASE ERROR:", error);
      return res.status(500).json({ error });
    }

    res.json({ success: true, data });

  } catch (err) {
    console.error("APPLY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// GET LEAVES
// ==============================
app.get("/api/leaves", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let query = supabase
      .from("leaves")
      .select("*, employees(name)");

    if (role === "Employee") {
      query = query.eq("employee_id", userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);

  } catch (err) {
    console.error("GET LEAVES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// UPDATE STATUS (PATCH FIXED)
// ==============================
app.patch("/api/leaves/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["Manager", "Team Lead"].includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    console.error("STATUS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// HEALTH
// ==============================
app.get("/", (req, res) => {
  res.send("Backend Running 🚀");
});

// ==============================
// START
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
