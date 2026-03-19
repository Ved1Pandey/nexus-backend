require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// ==============================
// 🔥 ROLE NORMALIZER
// ==============================

const normalizeRole = (role) => {
  if (!role) return "Employee";

  const r = role.toLowerCase();

  if (r.includes("manager")) return "Manager";
  if (r.includes("lead")) return "Team Lead";

  return "Employee";
};

// ==============================
// SUPABASE
// ==============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ==============================
// EMPLOYEES
// ==============================

app.get("/api/employees", async (req, res) => {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("id");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/employees", async (req, res) => {
  const { name, role, status, manager_id, email } = req.body;

  const { data, error } = await supabase
    .from("employees")
    .insert([
      {
        name,
        role,
        status,
        email: email?.toLowerCase(),
        manager_id: manager_id || null,
        leave_balance: 20,
      },
    ])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/employees/:id", async (req, res) => {
  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
// ==============================
// TEAM
// ==============================

app.get("/api/team/:userId/:role", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const role = normalizeRole(req.params.role);

    let result = [];

    if (role === "Manager") {
      const { data: tls } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);

      const tlIds = tls?.map(t => t.id) || [];

      const { data } = await supabase
        .from("employees")
        .select("*")
        .in("manager_id", [userId, ...tlIds]);

      result = data || [];
    }

    else if (role === "Team Lead") {
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("manager_id", userId);

      result = data || [];
    }

    else {
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("id", userId);

      result = data || [];
    }

    res.json(result);

  } catch (err) {
    console.log("TEAM ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// LEAVES
// ==============================

app.post("/api/leaves", async (req, res) => {
  try {
    const { employee_id, from_date, to_date, reason } = req.body;

    const { data, error } = await supabase
      .from("leaves")
      .insert([
        {
          employee_id: Number(employee_id),
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
    console.log("LEAVE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/leaves/:userId/:role", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const role = normalizeRole(req.params.role);

    let result = [];

    if (role === "Employee") {
      const { data } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .eq("employee_id", userId)
        .order("id", { ascending: false });

      result = data || [];
    }
    else if (role === "Team Lead") {
      const { data: team } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);

      const ids = team?.map(t => t.id) || [];

      const { data } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .in("employee_id", ids);

      result = data || [];
    }

    else if (role === "Manager") {
      const { data: tls } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);
const tlIds = tls?.map(t => t.id) || [];

      const { data: team } = await supabase
        .from("employees")
        .select("id")
        .in("manager_id", [userId, ...tlIds]);

      const ids = team?.map(e => e.id) || [];

      const { data } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .in("employee_id", ids);

      result = data || [];
    }

    res.json(result);
} catch (err) {
    console.log("LEAVE FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ATTENDANCE
// ==============================
app.post("/api/attendance/checkin", async (req, res) => 
  { try {
      const { employee_id } = req.body;
    const today = new Date().toISOString().split("T")[0];
const { data, error } = await supabase
      .from("attendance")
      .insert([
        {
          employee_id: Number(employee_id),
          date: today,
          check_in: new Date(),
        },
      ])
.select();

    if (error) throw error;
res.json(data);

  } catch (err) {
console.log("CHECKIN ERROR:", err);
res.status(500).json({ error: err.message });
}
});

app.post("/api/attendance/checkout", async (req, res) => {
  try {
const { employee_id } = req.body;
    const today = new Date().toISOString().split("T")[0];

    const { error } = await supabase
      .from("attendance")
      .update({ check_out: new Date() })
      .eq("employee_id", Number(employee_id))
      .eq("date", today);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    console.log("CHECKOUT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// LOGIN (🔥 FINAL FIX)
// ==============================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    const { data: users, error } = await supabase
      .from("Email")
      .select("*")
      .eq("email", cleanEmail);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = users[0];

    if (String(user.password).trim() !== String(password).trim()) {
      return res.status(401).json({ error: "Wrong password" });
    }

    const { data: emp } = await supabase
      .from("employees")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!emp) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json({
      id: emp.id,
      name: emp.name,
      role: emp.role,
    });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
// ==============================
// START
// ==============================

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
