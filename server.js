require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const PORT = 3001;

// ===== LOGIN =====
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: users, error } = await supabase
    .from("Email")
    .select("*")
    .eq("email", email.toLowerCase().trim());

  if (error || !users || users.length === 0) {
    return res.status(401).json({ error: "User not found" });
  }

  const user = users[0];

  if (String(user.password) !== String(password)) {
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
});

// ===== GET LEAVES =====
app.get("/api/leaves/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  const { data, error } = await supabase
    .from("leaves")
    .select("*")
    .eq("employee_id", userId);

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// ===== APPLY LEAVE =====
app.post("/api/leaves", async (req, res) => {
  try {
    const { employee_id, from_date, to_date, reason } = req.body;

    const { data, error } = await supabase.from("leaves").insert([
      {
        employee_id: Number(employee_id),
        from_date,
        to_date,
        reason,
        status: "PENDING",
      },
    ]);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: "Leave applied", data });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
app.get("/api/leaves/:userId/:role", async (req, res) => {

  const { userId, role } = req.params;

  try {

    let query = "";

    // EMPLOYEE → अपनी leaves
    if (role === "employee") {
      query = `
        SELECT * FROM leaves 
        WHERE employee_id = ${userId}
      `;
    }

    // MANAGER / TL → team leaves
    else {
      query = `
        SELECT l.*, e.name 
        FROM leaves l
        JOIN employees e ON l.employee_id = e.id
      `;
    }

    const result = await pool.query(query);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }

});
app.patch("/api/leaves/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await pool.query(
      "UPDATE leaves SET status = $1 WHERE id = $2",
      [status, id]
    );

    res.json({ message: "Updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});