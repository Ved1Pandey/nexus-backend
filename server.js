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
  // GET MY LEAVES (EMPLOYEE)
  // ==============================
 app.get("/api/team-leaves", authMiddleware, async (req, res) => {
  try {
    const role = (req.user.role || "").toLowerCase();

    // 🔹 TL/Manager → show all leaves (name included)
    if (role === "team lead" || role === "manager") {
      const { data, error } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .order("from_date", { ascending: false });

      if (error) throw error;

      return res.json(data);
    }

    // 🔹 fallback (shouldn’t hit normally)
    return res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  // ==============================
  // GET LEAVES (Team)
  // ==============================
 app.get("/api/team-leaves", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let employeeIds = [];

    // 🔹 TEAM LEAD
    if (role === "Team Lead") {
      const { data: team } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);

      employeeIds = team.map(e => e.id);
    }

    // 🔹 MANAGER → ALL employees except self
    if (role === "Manager") {
      const { data: all } = await supabase
        .from("employees")
        .select("id")
        .neq("id", userId);

      employeeIds = all.map(e => e.id);
    }

    if (!employeeIds.length) return res.json([]);

    const { data, error } = await supabase
      .from("leaves")
      .select("*, employees(name)")
      .in("employee_id", employeeIds)
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
        .from("leave_balances")
        .select("*")
        .eq("employee_id", req.user.id)
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

  // ==============================
  // ==============================
  // UPDATE LEAVE STATUS (Manager)
  // ==============================
  app.put("/api/leaves/:id", authMiddleware, async (req, res) => {
    try {
      const { status } = req.body; // APPROVED / REJECTED
      const leaveId = req.params.id;

      if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const { error } = await supabase
        .from("leaves")
        .update({ status })
        .eq("id", leaveId);

      if (error) throw error;

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });