  require("dotenv").config();

  const express = require("express");
  const app = express();
  const cors = require("cors");
  const jwt = require("jsonwebtoken");
  const { createClient } = require("@supabase/supabase-js");
  const multer = require("multer");
  const pdfParse = require("pdf-parse");
  const fs = require("fs");
  const nodemailer = require("nodemailer");
  const upload = multer({ dest: "uploads/" });
  
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const PORT = 3001;
  const JWT_SECRET = process.env.JWT_SECRET || "secret123";

  const supabase = createClient(
    "https://odswgsvccutgwwnoappf.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kc3dnc3ZjY3V0Z3d3bm9hcHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDM5NzIsImV4cCI6MjA4NzMxOTk3Mn0.4wNjBNqIqK4HUvWFu0Z5GejpvLsqTeLrXZwBbpuCtkg"
  );

  // ==============================
  // ROLE
  // ==============================
const normalizeRole = (role) => {
  if (!role) return "Employee";

  const r = String(role).toLowerCase().trim();

  if (r.includes("admin")) return "Admin";
  if (r.includes("manager")) return "Manager";
  if (r.includes("lead")) return "Team Lead";

  return "Employee";
};

  // ==============================
  // AUTH
  // ==============================
  const authMiddleware = (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token" });
      }

      const token = authHeader.split(" ")[1];
      const user = jwt.verify(token, JWT_SECRET);

      req.user = user;
      next();
    } catch {
      return res.status(403).json({ error: "Invalid token" });
    }
  };

  // ==============================
  // LOGIN
  // ==============================
  app.post("/api/login", async (req, res) => {
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

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

      res.json({ token, user: payload });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==============================
  // APPLY LEAVE
  // ==============================
  app.post("/api/leaves", authMiddleware, async (req, res) => {
    try {
      const { from_date, to_date, reason, type } = req.body;

      if (!from_date || !to_date || !reason || !type) {
        return res.status(400).json({ error: "Missing fields" });
      }

      if (new Date(from_date) > new Date(to_date)) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      const { data: existing } = await supabase
        .from("leaves")
        .select("from_date, to_date")
        .eq("employee_id", req.user.id);

      const overlap = existing?.some((l) => {
        return (
          new Date(from_date) <= new Date(l.to_date) &&
          new Date(to_date) >= new Date(l.from_date)
        );
      });

      if (overlap) {
        return res.status(400).json({ error: "Leave overlap ❌" });
      }

      const { error } = await supabase.from("leaves").insert([
        {
          employee_id: req.user.id,
          from_date,
          to_date,
          reason,
          type,
          status: "PENDING",
        },
      ]);

      if (error) {
  console.log("SUPABASE ERROR:", error);
  return res.status(500).json(error);
}

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // ==============================
  // New Block
  // ==============================
app.get("/api/leaves", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaves")
      .select("*")
      .eq("employee_id", req.user.id)
      .order("from_date", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  // ==============================
  // GET LEAVES (Team)
  // ==============================
 app.get("/api/team-leaves", async (req, res) => {
  try {
    const userId = 8; // temporary
const role = "Team Lead"; //

let employeeIds = [];

// ✅ TEAM LEAD → only his team
if (role === "Team Lead") {
  const { data: team } = await supabase
    .from("employees")
    .select("id")
   // .eq("manager_id", userId);// temporary disable

  employeeIds = team.map(e => e.id)
console.log("EMPLOYEE IDS (TL):", employeeIds);
}
// ✅ MANAGER → all except self
else if (role === "Manager") {
  const { data: all } = await supabase
    .from("employees")
    .select("id")
    .neq("id", userId);

  employeeIds = all.map(e => e.id)
console.log("EMPLOYEE IDS (Manager):", employeeIds);
}

// ❌ no team
if (!employeeIds.length) {
  return res.json([]);
}

// ✅ fetch leaves
const { data, error } = await supabase
  .from("leaves")
  .select("*, employees(name, role)")
  //.in("employee_id", employeeIds)
  .order("from_date", { ascending: false });

if (error) throw error;

res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
     
  // ==============================
  // LEAVE BALANCE
  // ==============================
  app.get("/api/leave-balance", authMiddleware, async (req, res) => {
    try {
    const { data } = await supabase
  .from("employees")
  .select("cl, sl, pl")
  .eq("id", req.user.id)
  .single();

res.json({
  CL: data.cl,
  SL: data.sl,
  PL: data.pl,
});

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==============================
  // ATTENDANCE ROUTES (🔥 MAIN FIX)
  // ==============================

  // ✅ GET ATTENDANCE (NEW - REQUIRED)
  app.get("/api/attendance", authMiddleware, async (req, res) => {
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

  // Punch In
  app.post("/api/punch-in", authMiddleware, async (req, res) => {
    try {
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({ error: "Location required ❌" });
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
        return res.status(400).json({ error: "Already punched in ❌" });
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

  // Punch Out
  app.post("/api/punch-out", authMiddleware, async (req, res) => {
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
        return res.status(400).json({ error: "No punch-in found ❌" });
      }

      await supabase
        .from("attendance")
        .update({ punch_out: new Date().toISOString() })
        .eq("id", records[0].id);

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // UPDATE LEAVE STATUS (Manager)
  // ==============================
app.put("/api/leaves/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  console.log("STATUS:", status);

  try {
    // 1. get leave data
    const { data: leave } = await supabase
      .from("leaves")
      .select("*")
      .eq("id", id)
      .single();

console.log("OLD STATUS:",
leave?.status)

    if (!leave) {
      return res.status(404).json({ error: "Leave not found" });
    }

    // 2. ONLY IF APPROVED → deduct balance
 console.log("STATUS:", status);
console.log("OLD STATUS:", leave.status);

if (status === "APPROVED" && leave.status !=="APPROVED") {
  console.log("ENTERED APPROVED BLOCK");

  const days =
  Math.ceil(
    (new Date(leave.to_date) - new Date(leave.from_date)) /
      (1000 * 60 * 60 * 24)) + 1;

  let column = "";

  if (leave.type === "CL") column = "cl";
  else if (leave.type === "SL") column = "sl";
  else column = "pl";

  console.log("COLUMN:", column);
  console.log("DAYS:", days);

  const { data: emp } = await supabase
    .from("employees")
    .select("cl, sl, pl")
    .eq("id", leave.employee_id)
    .single();

  console.log("EMP:", emp);

  const newBalance = Math.max((emp[column] || 0) - days, 0);

  console.log("NEW BALANCE:", newBalance);

  await supabase
    .from("employees")
    .update({ [column]: newBalance })
    .eq("id", leave.employee_id);
}


    // 3. update leave status (LAST में)
    const { data, error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", id)
      .select();

    if (error) throw error;

    // FINAL RESPONSE
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==============================
// ATS - RESUME UPLOAD
// ==============================
app.post("/api/upload-resume", upload.single("resume"), async (req, res) => {
  try {
    const email = req.body.email;
    console.log("EMAIL:", email);
    console.log("REQ BODY:", req.body);


    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);

  const pdfData = await pdfParse(dataBuffer);
const text = pdfData.text;

console.log("PDF TEXT LENGTH:", text?.length);
const fileName = `${Date.now()}-${req.file.originalname}`;

const fileBuffer = fs.readFileSync(filePath);

const { data: storageData, error: storageError } =
  await supabase.storage
    .from("resumes")
    .upload(fileName, fileBuffer, {
      contentType: "application/pdf",
    });

if (storageError) {
  console.log("STORAGE ERROR:", storageError);
}

const { data: publicData } = supabase.storage
  .from("resumes")
  .getPublicUrl(fileName);

const publicUrl = publicData.publicUrl;

console.log("PUBLIC URL:", publicUrl);

fs.unlinkSync(filePath);

const { data, error } = await supabase
  .from("candidates")
  .upsert(
    [
      {
        resume_text: text,
        email: email
      }
    ],
    {
      onConflict: "email"
    }
  )
  .select();

console.log("SUPABASE DATA:", data);
console.log("SUPABASE ERROR:", error);

if (error) {
  return res.status(500).json({ error: error.message });
}

if (!data || !data.length) {
  return res.status(500).json({ error: "No candidate returned" });
}

if (error) {
  console.log("SUPABASE ERROR:", error);
  return res.status(500).json({
    error: error.message
  });
}

if (!data || !data.length) {
  return res.status(500).json({
    error: "No candidate returned"
  });
}

return res.json({
  text,
  candidateId: data[0].id,
  publicUrl,
});


  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==============================
// ATS - MATCH SCORE
// ==============================
app.post("/api/match", async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const {
      text: resumeText = "",
      jobDesc = "",
      candidateId
    } = req.body || {};
    console.log("REQ BODY:", req.body);
    console.log("RESUME TEXT:", resumeText?.length);
    console.log("JOB DESC:", jobDesc);
    console.log("CANDIDATE:", candidateId);

    if (!candidateId) {
      return res.status(400).json({
        error: "candidateId missing"
      });
    }

    const stopwords = [
      "the",
      "is",
      "and",
      "of",
      "in",
      "to"
    ];

    const clean = (text) =>
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 2 &&
            !stopwords.includes(w)
        );

    const resumeWords = new Set(clean(resumeText));
const jdWords = clean(jobDesc);
const uniqueJD = [...new Set(jdWords)];

const synonyms = {
  tat: ["turnaround", "time"],
  sla: ["service", "level", "agreement"],
  ops: ["operations"],
  hr: ["human", "resource"],
  sap: ["s4hana", "sd"],
  excel: ["advanced", "spreadsheet"],
  crm: ["customer", "management"],
  mis: ["reporting"],
};

let matchCount = 0;
 /*const { data: appData, error: appError } = await supabase
  .from("applications")
  .insert([
    {
      candidate_name: user?.email?.split("@")[0],
      candidate_email: user?.email,
      job_id: selectedJob,
      resume_url: resumeUrl,
      score: matchData.score,
      status: "Applied",
    },
  ])
  .select();
*/

    uniqueJD.forEach((word) => {
      if (resumeWords.has(word)) {
        matchCount++;
      } else if (synonyms[word]) {
        const found = synonyms[word].some(
          (s) => resumeWords.has(s)
        );

        if (found) matchCount++;
      }
    });

    const score = uniqueJD.length
      ? (
          (matchCount / uniqueJD.length) *
          100
        ).toFixed(2)
      : "0.00";

    const { data, error } = await supabase
    .from("candidates")
    .update({
    score: Number(score)
    })
    .eq("id", Number(candidateId))
    .select();

    console.log("UPDATED:", data);
    console.log("UPDATE ERROR:", error);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    return res.json({ score });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
});
app.get("/api/candidates", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("candidates")
      .select("*")
      .order("score", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/work-request", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body;

    const { error } = await supabase
      .from("work_requests")
      .insert({
        employee_id: req.user.id,
        type: type,
      });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/work-request", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("work_requests")
      .select("*, employees(name)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/work-request/:id", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    const { error } = await supabase
      .from("work_requests")
      .update({
        status,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/applications", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("applications")
      .select(`
        *,
        jobs(title)
      `)
      .order("score", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ==============================
// EMPLOYEE DIRECTORY
// ==============================

app.get("/api/employees", authMiddleware, async (req, res) => {
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

// ==============================
// ATTENDANCE REGULARIZATION
// ==============================

// Employee submits request
app.post("/api/attendance-regularization", authMiddleware, async (req, res) => {
  try {
    const {
      attendance_date,
      new_punch_in,
      new_punch_out,
      reason,
    } = req.body;

    const { error } = await supabase
      .from("attendance_regularization")
      .insert({
        employee_id: req.user.id,
        attendance_date,
        new_punch_in,
        new_punch_out,
        reason,
      });

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee history
app.get("/api/attendance-regularization", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("attendance_regularization")
      .select("*")
      .eq("employee_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Manager / Team Lead - View Attendance Regularization Requests
app.get(
  "/api/team-attendance-regularization",
  authMiddleware,
  async (req, res) => {
    try {
      console.log("TEAM ATTENDANCE USER:", req.user);

      // 1. Fetch requests WITHOUT Supabase relationship join
      const { data: requests, error: requestError } = await supabase
        .from("attendance_regularization")
        .select("*")
        .order("created_at", { ascending: false });

      if (requestError) {
        console.log("REQUEST ERROR:", requestError);
        throw requestError;
      }

      if (!requests || requests.length === 0) {
        return res.json([]);
      }

      // 2. Get employee IDs
      const employeeIds = [
        ...new Set(
          requests
            .map((request) => request.employee_id)
            .filter(Boolean)
        ),
      ];

      // 3. Fetch employees separately
      const { data: employees, error: employeeError } = await supabase
        .from("employees")
        .select("id, name, role")
        .in("id", employeeIds);

      if (employeeError) {
        console.log("EMPLOYEE ERROR:", employeeError);
        throw employeeError;
      }

      // 4. Manually merge employee data
      const result = requests.map((request) => ({
        ...request,
        employees:
          employees?.find(
            (employee) =>
              Number(employee.id) === Number(request.employee_id)
          ) || null,
      }));

      console.log("TEAM ATTENDANCE RESULT:", result);

      return res.json(result);
    } catch (err) {
      console.log("TEAM ATTENDANCE FULL ERROR:", err);

      return res.status(500).json({
        error: err.message,
      });
    }
  }
);


// Manager approve/reject
app.put("/api/attendance-regularization/:id", authMiddleware, async (req, res) => {
  try {

    const { status } = req.body;

    const { error } = await supabase
      .from("attendance_regularization")
      .update({
        status,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==============================
// FORGOT PASSWORD / OTP
// ==============================

const otpStore = new Map();

const mailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// SEND OTP
app.post("/api/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const { data: users, error } = await supabase
      .from("Email")
      .select("id, email")
      .eq("email", email);

    if (error) {
      console.log("FORGOT PASSWORD SUPABASE ERROR:", error);
      return res.status(500).json({
        message: "Server error",
      });
    }

    if (!users || users.length === 0) {
      return res.status(404).json({
        message: "Email not found",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    await mailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "NexusHR - Password Reset OTP",
      text: `Your NexusHR password reset OTP is ${otp}. This OTP is valid for 10 minutes.`,
    });

    console.log(`OTP sent to ${email}`);

    res.json({
      message: "OTP sent successfully",
    });

  } catch (err) {
    console.log("SEND OTP ERROR:", err);

    res.status(500).json({
      message: "Failed to send OTP",
    });
  }
});


// VERIFY OTP
app.post("/api/verify-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const otp = String(req.body.otp || "").trim();

    const saved = otpStore.get(email);

    if (!saved) {
      return res.status(400).json({
        message: "OTP expired or not found",
      });
    }

    if (Date.now() > saved.expiresAt) {
      otpStore.delete(email);

      return res.status(400).json({
        message: "OTP expired",
      });
    }

    if (saved.otp !== otp) {
      return res.status(400).json({
        message: "Invalid OTP",
      });
    }

    otpStore.set(email, {
      ...saved,
      verified: true,
    });

    res.json({
      message: "OTP verified successfully",
    });

  } catch (err) {
    console.log("VERIFY OTP ERROR:", err);

    res.status(500).json({
      message: "Failed to verify OTP",
    });
  }
});


// RESET PASSWORD
app.post("/api/reset-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");

    const saved = otpStore.get(email);

    if (!saved || !saved.verified) {
      return res.status(400).json({
        message: "Please verify OTP first",
      });
    }

    if (Date.now() > saved.expiresAt) {
      otpStore.delete(email);

      return res.status(400).json({
        message: "OTP session expired",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const { error } = await supabase
      .from("Email")
      .update({
        password: password,
      })
      .eq("email", email);

    if (error) {
      console.log("RESET PASSWORD SUPABASE ERROR:", error);

      return res.status(500).json({
        message: "Failed to reset password",
      });
    }

    otpStore.delete(email);

    res.json({
      message: "Password reset successfully",
    });

  } catch (err) {
    console.log("RESET PASSWORD ERROR:", err);

    res.status(500).json({
      message: "Failed to reset password",
    });
  }
});
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
 //vedpandey
 //vedpandey
 //vedpandey