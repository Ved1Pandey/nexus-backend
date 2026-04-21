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

  const supabase = createClient(
    "https://odswgsvccutgwwnoappf.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kc3dnc3ZjY3V0Z3d3bm9hcHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDM5NzIsImV4cCI6MjA4NzMxOTk3Mn0.4wNjBNqIqK4HUvWFu0Z5GejpvLsqTeLrXZwBbpuCtkg"
  );

  // ==============================
  // ROLE
  // ==============================
  const normalizeRole = (role) => {
    if (!role) return "Employee";
    const r = role.toLowerCase();

    if (r.includes("manager")) return "Manager";
    if (r.includes("lead")) return "Team Lead";

    return "Employee";
  };

  // ==============================
  // AUTH
  // ==============================
  const authMiddleware = (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token" });
      }

      const token = authHeader.split(" ")[1];
      const user = jwt.verify(token, JWT_SECRET);

      req.user = user;
      next();
    } catch {
      return res.status(403).json({ error: "Invalid token" });
    }
  };

  // ==============================
  // LOGIN
  // ==============================
  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      const { data: users } = await supabase
        .from("Email")
        .select("*")
        .eq("email", email.toLowerCase().trim());

      if (!users?.length) {
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

      const payload = {
        id: emp.id,
        name: emp.name,
        role: normalizeRole(emp.role),
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

      res.json({ token, user: payload });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==============================
  // APPLY LEAVE
  // ==============================
  app.post("/api/leaves", authMiddleware, async (req, res) => {
    try {
      const { from_date, to_date, reason, type } = req.body;

      if (!from_date || !to_date || !reason || !type) {
        return res.status(400).json({ error: "Missing fields" });
      }

      if (new Date(from_date) > new Date(to_date)) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      const { data: existing } = await supabase
        .from("leaves")
        .select("from_date, to_date")
        .eq("employee_id", req.user.id);

      const overlap = existing?.some((l) => {
        return (
          new Date(from_date) <= new Date(l.to_date) &&
          new Date(to_date) >= new Date(l.from_date)
        );
      });

      if (overlap) {
        return res.status(400).json({ error: "Leave overlap ❌" });
      }

      const { error } = await supabase.from("leaves").insert([
        {
          employee_id: req.user.id,
          from_date,
          to_date,
          reason,
          type,
          status: "PENDING",
        },
      ]);

      if (error) throw error;

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // ==============================
  // New Block
  // ==============================
app.get("/api/leaves", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaves")
      .select("*")
      .eq("employee_id", req.user.id)
      .order("from_date", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  // ==============================
  // GET LEAVES (Team)
  // ==============================
 app.get("/api/team-leaves", async (req, res) => {
  try {
    const userId = 8; // temporary
const role = "Team Lead"; //

let employeeIds = [];

// ✅ TEAM LEAD → only his team
if (role === "Team Lead") {
  const { data: team } = await supabase
    .from("employees")
    .select("id")
   // .eq("manager_id", userId);// temporary disable

  employeeIds = team.map(e => e.id)
console.log("EMPLOYEE IDS (TL):", employeeIds);
}
// ✅ MANAGER → all except self
else if (role === "Manager") {
  const { data: all } = await supabase
    .from("employees")
    .select("id")
    .neq("id", userId);

  employeeIds = all.map(e => e.id)
console.log("EMPLOYEE IDS (Manager):", employeeIds);
}

// ❌ no team
if (!employeeIds.length) {
  return res.json([]);
}

// ✅ fetch leaves
const { data, error } = await supabase
  .from("leaves")
  .select("*, employees(name, role)")
  //.in("employee_id", employeeIds)
  .order("from_date", { ascending: false });

if (error) throw error;

res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
     
  // ==============================
  // LEAVE BALANCE
  // ==============================
  app.get("/api/leave-balance", authMiddleware, async (req, res) => {
    try {
    const { data } = await supabase
  .from("employees")
  .select("cl, sl, pl")
  .eq("id", req.user.id)
  .single();

res.json({
  CL: data.cl,
  SL: data.sl,
  PL: data.pl,
});

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==============================
  // ATTENDANCE ROUTES (🔥 MAIN FIX)
  // ==============================

  // ✅ GET ATTENDANCE (NEW - REQUIRED)
  app.get("/api/attendance", authMiddleware, async (req, res) => {
    try {
      const { data } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", req.user.id)
        .order("punch_in", { ascending: false });

      res.json(data);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Punch In
  app.post("/api/punch-in", authMiddleware, async (req, res) => {
    try {
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({ error: "Location required ❌" });
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: existing } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", req.user.id)
        .gte("punch_in", todayStart.toISOString())
        .is("punch_out", null);

      if (existing?.length > 0) {
        return res.status(400).json({ error: "Already punched in ❌" });
      }

      await supabase.from("attendance").insert([
        {
          employee_id: req.user.id,
          punch_in: new Date().toISOString(),
          latitude,
          longitude,
        },
      ]);

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Punch Out
  app.post("/api/punch-out", authMiddleware, async (req, res) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: records } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", req.user.id)
        .gte("punch_in", todayStart.toISOString())
        .is("punch_out", null);

      if (!records?.length) {
        return res.status(400).json({ error: "No punch-in found ❌" });
      }

      await supabase
        .from("attendance")
        .update({ punch_out: new Date().toISOString() })
        .eq("id", records[0].id);

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // UPDATE LEAVE STATUS (Manager)
  // ==============================
app.put("/api/leaves/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // 1. get leave data
    const { data: leave } = await supabase
      .from("leaves")
      .select("*")
      .eq("id", id)
      .single();

    if (!leave) {
      return res.status(404).json({ error: "Leave not found" });
    }

    // 2. ONLY IF APPROVED → deduct balance
    if (status === "APPROVED") {
  const days =
    (new Date(leave.to_date) - new Date(leave.from_date)) /
      (1000 * 60 * 60 * 24) + 1;

  let column = "";

  if (leave.type === "CL") column = "cl";
  else if (leave.type === "SL") column = "sl";
  else column = "pl";

  const { data: emp } = await supabase
    .from("employees")
    .select("cl, sl, pl")
    .eq("id", leave.employee_id)
    .single();

  if (!emp) {
    return res.status(400).json({ error: "Employee not found" });
  }

  const newBalance = Math.max((emp[column] || 0) - days, 0);

  await supabase
    .from("employees")
    .update({ [column]: newBalance })
    .eq("id", leave.employee_id);
}


    // 3. update leave status (LAST में)
    const { data, error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", id)
      .select();

    if (error) throw error;

    // FINAL RESPONSE
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });