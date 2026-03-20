require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// ==============================
// SUPABASE
// ==============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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
// EMPLOYEES
// ==============================
app.get("/api/employees", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("id");

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.log("EMP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
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

// APPLY
app.post("/api/leaves", async (req, res) => {
  try {
    const { employee_id, from_date, to_date, reason } = req.body;

    const { error } = await supabase
      .from("leaves")
      .insert([
        {
          employee_id: Number(employee_id),
          from_date,
          to_date,
          reason,
          status: "PENDING",
        },
      ]);

    if (error) throw error;

    res.json({ message: "Leave applied" });

  } catch (err) {
    console.log("APPLY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET LEAVES
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
    console.log("FETCH LEAVE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// APPROVE / REJECT + BALANCE UPDATE
app.patch("/api/leaves/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: leave, error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 🔥 BALANCE LOGIC
    if (status === "APPROVED") {
      const days =
        (new Date(leave.to_date) - new Date(leave.from_date)) /
          (1000 * 60 * 60 * 24) + 1;

      const { data: emp } = await supabase
        .from("employees")
        .select("leave_balance")
        .eq("id", leave.employee_id)
        .single();

      const newBalance = Math.max(0, emp.leave_balance - days);

      await supabase
        .from("employees")
        .update({ leave_balance: newBalance })
        .eq("id", leave.employee_id);
    }

    res.json({ success: true });

  } catch (err) {
    console.log("STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// LOGIN
// ==============================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    const { data: users } = await supabase
      .from("Email")
      .select("*")
      .eq("email", cleanEmail);

    if (!users || users.length === 0) {
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
