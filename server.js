require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ✅ test route
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

// ✅ get employees
app.get("/api/employees", async (req, res) => {
  const { data, error } = await supabase
    .from("employees")
    .select("*");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// ✅ start server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log("🚀 Server started on port " + PORT);
  console.log("👉 http://localhost:" + PORT + "/api/employees");
});