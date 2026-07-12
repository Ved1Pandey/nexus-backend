module.exports = (supabase, authMiddleware) => {
  const express = require("express");
  const router = express.Router();

  // APPLY LEAVE
  router.post("/leaves", authMiddleware, async (req, res) => {
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

      if (error) {
        console.log("SUPABASE ERROR:", error);
        return res.status(500).json(error);
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // MY LEAVES
  router.get("/leaves", authMiddleware, async (req, res) => {
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

  // TEAM LEAVES
  router.get("/team-leaves", async (req, res) => {
    try {
      const userId = 8;
      const role = "Team Lead";

      let employeeIds = [];

      if (role === "Team Lead") {
        const { data: team } = await supabase
          .from("employees")
          .select("id");

        employeeIds = team.map((e) => e.id);
        console.log("EMPLOYEE IDS (TL):", employeeIds);
      } else if (role === "Manager") {
        const { data: all } = await supabase
          .from("employees")
          .select("id")
          .neq("id", userId);

        employeeIds = all.map((e) => e.id);
        console.log("EMPLOYEE IDS (Manager):", employeeIds);
      }

      if (!employeeIds.length) {
        return res.json([]);
      }

      const { data, error } = await supabase
        .from("leaves")
        .select("*, employees(name, role)")
        .order("from_date", { ascending: false });

      if (error) throw error;

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // LEAVE BALANCE
  router.get("/leave-balance", authMiddleware, async (req, res) => {
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

  // UPDATE LEAVE STATUS
  router.put("/leaves/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
      const { data: leave } = await supabase
        .from("leaves")
        .select("*")
        .eq("id", id)
        .single();

      if (!leave) {
        return res.status(404).json({ error: "Leave not found" });
      }

      if (status === "APPROVED" && leave.status !== "APPROVED") {
        const days =
          Math.ceil(
            (new Date(leave.to_date) - new Date(leave.from_date)) /
              (1000 * 60 * 60 * 24)
          ) + 1;

        let column = "";

        if (leave.type === "CL") column = "cl";
        else if (leave.type === "SL") column = "sl";
        else column = "pl";

        const { data: emp } = await supabase
          .from("employees")
          .select("cl, sl, pl")
          .eq("id", leave.employee_id)
          .single();

        const newBalance = Math.max((emp[column] || 0) - days, 0);

        await supabase
          .from("employees")
          .update({ [column]: newBalance })
          .eq("id", leave.employee_id);
      }

      const { data, error } = await supabase
        .from("leaves")
        .update({ status })
        .eq("id", id)
        .select();

      if (error) throw error;

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};