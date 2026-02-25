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
// GET employee by id
app.get("/api/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ✅ POST add employee (WITH VALIDATION)
app.post("/api/employees", async (req, res) => {
  try {
    const { name, role, status } = req.body;

    // 🔴 validation
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

   // validation
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
    // 🔥 employee not found check
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
    const { id } = req.params;

    // 🔴 validation
    if (!id || isNaN(Number(id))) {
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

    // 🔥 employee not found
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json({ message: "Employee deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// 🚀 server start
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});