require("dotenv").config();
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const { createClient } = require("@supabase/supabase-js");

// ✅ SUPABASE CONNECT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);



// ================= APPLY LEAVE =================
app.post("/api/leaves", async (req, res) => {
  const { employee_id, from_date, to_date, reason } = req.body;

  if (!employee_id) {
    return res.status(400).json({ error: "employee_id missing" });
  }

  try {
    const { data, error } = await supabase
      .from("leaves")
      .insert([
        {
          employee_id,
          from_date,
          to_date,
          reason,
          status: "PENDING"
        }
      ]);

    if (error) return res.status(500).json({ error });

    res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



// ================= GET LEAVES =================
app.get("/api/leaves/:userId/:role", async (req, res) => {

  const { userId, role } = req.params;

  try {

    // 🔥 MANAGER / TEAM LEAD
    if (role.includes("manager") || role.includes("team")) {

      // team fetch
      const { data: team, error: teamError } = await supabase
        .from("employees")
        .select("id")
        .eq("manager_id", userId);

      if (teamError) return res.status(500).json({ error: teamError });

      const ids = team.map(e => e.id);

      // leaves fetch
      const { data, error } = await supabase
        .from("leaves")
        .select("*, employees(name)")
        .in("employee_id", ids);

      if (error) return res.status(500).json({ error });

      return res.json(data);
    }

    // 🔥 EMPLOYEE
    const { data, error } = await supabase
      .from("leaves")
      .select("*")
      .eq("employee_id", userId);

    if (error) return res.status(500).json({ error });

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



// ================= APPROVE / REJECT =================
app.patch("/api/leaves/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {

    const { data, error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", id);

    if (error) return res.status(500).json({ error });

    res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



// ================= SERVER =================
console.log(process.env.SUPABASE_URL);
console.log(process.env.SUPABASE_ANON_KEY);
app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});