const express = require("express");

module.exports = (supabase, authMiddleware) => {
  const router = express.Router();

  router.get("/employees", authMiddleware, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("*");

      console.log("EMP DATA:", data);
      console.log("EMP ERROR:", error);

      if (error) throw error;

      res.json(data);
    } catch (err) {
      console.log("FULL ERROR:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
