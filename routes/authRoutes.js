const express = require("express");

module.exports = (supabase, jwt, JWT_SECRET, normalizeRole) => {
  const router = express.Router();

  router.post("/login", async (req, res) => {
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

      const { data: emp, error: empError } = await supabase
        .from("employees")
        .select("*")
        .eq("id", user.id)
        .single();

      if (empError || !emp) {
        return res.status(500).json({ error: "Employee not found" });
      }

      const payload = {
        id: emp.id,
        name: emp.name,
        role: normalizeRole(emp.role),
      };

      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.json({
        token,
        user: payload,
      });
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  return router;
};
