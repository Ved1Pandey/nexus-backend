require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// ==============================
// SUPABASE
// ==============================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// ==============================
// EMPLOYEES API
// ==============================

// GET ALL EMPLOYEES
app.get("/api/employees", async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("id",{ascending:true})

    if(error) throw error

    res.json(data)

  } catch(err) {

    res.status(500).json({error:err.message})

  }
});

// ADD EMPLOYEE
app.post("/api/employees", async (req, res) => {
  try {

    const { name, role, status } = req.body;

    const { data, error } = await supabase
      .from("employees")
      .insert([
        {
          name,
          role,
          status,
          leave_balance:20
        }
      ])
      .select()

    if(error) throw error

    res.json(data)

  } catch(err){

    res.status(500).json({error:err.message})

  }
});


// DELETE EMPLOYEE
app.delete("/api/employees/:id", async (req, res) => {
  try {

    const id = Number(req.params.id)

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id",id)

    if(error) throw error

    res.json({message:"Employee deleted"})

  } catch(err){

    res.status(500).json({error:err.message})

  }
});


// ==============================
// MANAGER TEAM API
// ==============================

app.get("/api/team/:managerId", async (req,res)=>{

try{

const managerId = req.params.managerId

const {data,error} = await supabase
.from("employees")
.select("*")
.eq("manager_id",managerId)

if(error) throw error

res.json(data)

}catch(err){

res.status(500).json({error:err.message})

}

})


// ==============================
// APPLY LEAVE
// ==============================

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
          status:"PENDING"
        }
      ])
      .select()

    if(error) throw error

    res.json(data)

  } catch(err){

    res.status(500).json({error:err.message})

  }
});


// ==============================
// GET LEAVES + EMPLOYEE NAME
// ==============================

app.get("/api/leaves", async (req,res)=>{

try{

const {data,error} = await supabase
.from("leaves")
.select(`
id,
from_date,
to_date,
reason,
status,
employee_id,
employees(name)
`)
.order("id",{ascending:false})

if(error) throw error

res.json(data)

}catch(err){

res.status(500).json({error:err.message})

}

})


// ==============================
// APPROVE / REJECT LEAVE
// ==============================

app.patch("/api/leaves/:id/status", async (req, res) => {

  try {

    const { status } = req.body;
    const leaveId = req.params.id;

    const { data:leaveData, error:leaveError } = await supabase
      .from("leaves")
      .select("*")
      .eq("id",leaveId)
      .single()

    if(leaveError) throw leaveError

    const { error:updateError } = await supabase
      .from("leaves")
      .update({status})
      .eq("id",leaveId)

    if(updateError) throw updateError


    if(status==="APPROVED"){

      const from = new Date(leaveData.from_date)
      const to = new Date(leaveData.to_date)

      const diffDays =
      Math.ceil((to-from)/(1000*60*60*24))+1

      const {data:emp} = await supabase
      .from("employees")
      .select("leave_balance")
      .eq("id",leaveData.employee_id)
      .single()

      const newBalance =
      emp.leave_balance - diffDays

      await supabase
      .from("employees")
      .update({leave_balance:newBalance})
      .eq("id",leaveData.employee_id)

    }

    res.json({success:true})

  } catch(err){

    res.status(500).json({error:err.message})

  }

});


// ==============================
// LOGIN API
// ==============================

app.post("/api/login", async (req,res)=>{

try{

const {email,password} = req.body

const {data,error} = await supabase
.from("users")
.select("*")
.eq("email",email)
.single()

if(error || !data){

return res.status(401).json({error:"User not found"})

}

if(String(data.password)!==String(password)){

return res.status(401).json({error:"Invalid password"})

}

res.json({

id:data.id,
name:data.name,
role:data.role

})

}catch(err){

res.status(500).json({error:err.message})

}

})


// ==============================
// SERVER START
// ==============================

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
