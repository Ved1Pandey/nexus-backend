require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 Supabase config
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const PORT = 3001;

// ✅ GET all employees
app.get("/api/employees", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET employee by id
app.get("/api/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", Number (id))
      .single();

    if (error) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST add employee
app.post("/api/employees", async (req, res) => {
  try {
    const { name, role, status } = req.body;

    if (!name?.trim() || !role?.trim() || !status?.trim()) {
      return res.status(400).json({
        error: "name, role and status are required",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .insert([{ name, role, status }])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PUT update employee
app.put("/api/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, status } = req.body;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        error: "Valid employee id is required",
      });
    }

    if (!name || !role || !status) {
      return res.status(400).json({
        error: "name, role and status are required",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({ name, role, status })
      .eq("id", id)
      .select();

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ DELETE employee
app.delete("/api/employees/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: "Valid employee id is required",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json({ message: "Employee deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🚀 server start
app.listen(3001, () => {
  console.log("Server started on port 3001");
});
// ===============================
// APPLY LEAVE
// ===============================
app.post("/api/leaves", async (req, res) => {
  try {
    const { employee_id, from_date, to_date, reason } = req.body;

    const { data, error } = await supabase
      .from("leaves")
      .insert([
        {
          employee_id,
          from_date,
          to_date,
          reason,
          status: "PENDING",
        },
      ])
      .select();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ===============================
// GET ALL LEAVES
// ===============================
app.get("/api/leaves", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaves")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ================================
// APPROVE / REJECT LEAVE
// ================================
app.patch("/api/leaves/:id/status", async (req, res) => {
  try {
    const { status } = req.body; // APPROVED or REJECTED
    const { id } = req.params;

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
// LOGIN API
app.post("/api/login", async (req, res) => {

 try {

  const { email, password } = req.body;

  const { data, error } = await supabase
   .from("users")
   .select("*")
   .eq("email", email)
   .single();

  if (error || !data) {
   return res.status(401).json({ error: "User not found" });
  }

  if (String(data.password) !== String(password)) {
  return res.status(401).json({ error: "Invalid password" });
}
  res.json({
   id: data.id,
   name: data.name,
   role: data.role
  });

 } catch (err) {
  res.status(500).json({error:
    err.message});
  }
});