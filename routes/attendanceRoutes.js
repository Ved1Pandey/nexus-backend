const express = require("express");

module.exports = (supabase, authMiddleware) => {
  const router = express.Router();

  // GET ATTENDANCE
  router.get("/attendance", authMiddleware, async (req, res) => {
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

  // PUNCH IN
  router.post("/punch-in", authMiddleware, async (req, res) => {
    try {
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({
          error: "Location required ❌",
        });
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
        return res.status(400).json({
          error: "Already punched in ❌",
        });
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

  // PUNCH OUT
  router.post("/punch-out", authMiddleware, async (req, res) => {
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
        return res.status(400).json({
          error: "No punch-in found ❌",
        });
      }

      await supabase
        .from("attendance")
        .update({
          punch_out: new Date().toISOString(),
        })
        .eq("id", records[0].id);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
