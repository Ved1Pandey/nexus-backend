require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || "secret123";

console.log("JWT_SECRET:", JWT_SECRET);

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
// AUTH MIDDLEWARE
// ==============================
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token" });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Invalid format" });
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

    const { data: users, error } = await supabase
      .from("Email")
      .select("*")
      .eq("email", email.toLowerCase().trim());

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
      expiresIn: "7d",
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

    if (error) throw error;

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// GET LEAVES
// ==============================
app.get("/api/leaves", authMiddleware, async (req, res) => {
  try {
    let query = supabase.from("leaves").select("*");

    if (req.user.role === "Employee") {
      query = query.eq("employee_id", req.user.id);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// UPDATE STATUS ✅ FIXED
// ==============================
app.patch("/api/leaves/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    // 🔥 FIX: lowercase check
    if (!["manager", "team lead"].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
