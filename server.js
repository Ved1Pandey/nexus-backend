require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// APPLY LEAVE
app.post("/api/leaves", async (req, res) => {
  const { employee_id, from_date, to_date, reason } = req.body;

  if (!employee_id) {
    return res.status(400).json({ error: "employee_id missing" });
  }

  const { data, error } = await supabase
    .from("leaves")
    .insert([{ employee_id, from_date, to_date, reason, status: "PENDING" }]);

  if (error) return res.status(500).json({ error });

  res.json(data);
});

// GET LEAVES
app.get("/api/leaves/:userId/:role", async (req, res) => {
  const { userId, role } = req.params;

  try {

    if (role.includes("manager") || role.includes("team")) {

      const { data: team } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);

      if (!team || team.length === 0) {
        return res.json([]);
      }

      const ids = team.map(e => e.id);

      const { data } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .in("employee_id", ids);

      return res.json(data || []);
    }

    const { data } = await supabase
      .from("leaves")
      .select("*")
      .eq("employee_id", userId);

    res.json(data || []);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// APPROVE
app.patch("/api/leaves/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const { data, error } = await supabase
    .from("leaves")
    .update({ status })
    .eq("id", id);

  if (error) return res.status(500).json({ error });

  res.json(data);
});

app.listen(3001, () => {
  console.log("✅ Server running on http://localhost:3001");
});