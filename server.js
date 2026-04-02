require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3001;

// ==============================
// SUPABASE INIT (HARDCODED - WORKING)
// ==============================

const supabase = createClient(
  "https://odswgsvccutgwwnoappf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kc3dnc3ZjY3V0Z3d3bm9hcHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDM5NzIsImV4cCI6MjA4NzMxOTk3Mn0.4wNjBNqIqK4HUvWFu0Z5GejpvLsqTeLrXZwBbpuCtkg"
);

// ==============================
// ROLE NORMALIZER
// ==============================

const normalizeRole = (role) => {
  if (!role) return "employee";

  const r = role.toLowerCase();

  if (r.includes("manager")) return "manager";
  if (r.includes("lead")) return "team lead";

  return "employee";
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

    res.json({
      id: emp.id,
      name: emp.name,
      role: emp.role,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// APPLY LEAVE
// ==============================

app.post("/api/leaves", async (req, res) => {
  try {
    const { employee_id, from_date, to_date, reason } = req.body;

    const { error } = await supabase.from("leaves").insert([
      {
        employee_id,
        from_date,
        to_date,
        reason,
        status: "PENDING",
      },
    ]);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("APPLY LEAVE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// GET LEAVES
// ==============================

app.get("/api/leaves/:userId/:role", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const role = normalizeRole(req.params.role);

    let data;

    if (role === "employee") {
      const resDb = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .eq("employee_id", userId);

      if (resDb.error) throw resDb.error;
      data = resDb.data;
    } else {
      const resDb = await supabase
        .from("leaves")
        .select("*, employees(name)");

      if (resDb.error) throw resDb.error;
      data = resDb.data;
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET LEAVES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// APPROVE / REJECT
// ==============================

app.patch("/api/leaves/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
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
// TEAM VIEW
// ==============================

app.get("/api/team/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("manager_id", userId);

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("TEAM ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.send("NexusHR Backend Running 🚀");
});

// ==============================
// START
// ==============================

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});