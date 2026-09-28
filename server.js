  require("dotenv").config();

  const express = require("express");
  const app = express();
  const cors = require("cors");
  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const { createClient } = require("@supabase/supabase-js");
  const authRoutes = require("./routes/authRoutes");
  const multer = require("multer");
  const pdfParse = require("pdf-parse");
  const fs = require("fs");
  const path = require("path");
  const MAX_RESUME_BYTES = 5 * 1024 * 1024;
  const upload = multer({
    dest: "uploads/",
    limits: { fileSize: MAX_RESUME_BYTES },
    fileFilter: (req, file, cb) => {
      const original = String(file.originalname || "").toLowerCase();
      const mime = String(file.mimetype || "").toLowerCase();
      if (mime === "application/pdf" && original.endsWith(".pdf")) {
        return cb(null, true);
      }
      return cb(new Error("Only PDF files are allowed"));
    },
  });

  const cleanupMulterFile = (file) => {
    if (!file || !file.path) return;
    try {
      fs.unlinkSync(file.path);
    } catch {
    }
  };

  const safeResumeFilename = (originalname) => {
    const base = path.basename(String(originalname || "resume.pdf"));
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!cleaned.toLowerCase().endsWith(".pdf")) {
      return "resume.pdf";
    }
    return cleaned.slice(0, 120);
  };
  
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        const allowedOrigins = [
          "https://nexushr-5g11.onrender.com",
          "http://localhost:5173",
          "http://localhost:4173",
        ];
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: false,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/auth", authRoutes);

  const PORT = process.env.PORT || 3001;
  const JWT_SECRET = process.env.JWT_SECRET;
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY);

  async function findEmailForLogin(normalizedEmail) {
    return supabaseAdmin
      .from("Email")
      .select("id, email, password")
      .eq("email", normalizedEmail);
  }

  async function updateEmailPassword(normalizedEmail, hashedPassword) {
    return supabaseAdmin
      .from("Email")
      .update({
        password: hashedPassword,
      })
      .eq("email", normalizedEmail);
  }

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

  const APPROVER_ROLES = ["Admin", "Manager", "Team Lead"];

  const requireApproverRole = (req, res, next) => {
    const role = req.user && req.user.role;
    if (!APPROVER_ROLES.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  // ==============================
  // LOGIN
  // ==============================
  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      const { data: users } = await findEmailForLogin(
        email.toLowerCase().trim()
      );

      if (!users?.length) {
        return res.status(401).json({ error: "User not found" });
      }

      const user = users[0];

      let passwordOk = false;
      try {
        passwordOk = await bcrypt.compare(
          String(password).trim(),
          user.password
        );
      } catch {
        passwordOk = false;
      }

      if (!passwordOk) {
        return res.status(401).json({ error: "Wrong password" });
      }

      const { data: emp, error: empError } = await supabaseAdmin
  .from("employees")
  .select("id, name, role")
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

      const { data: existing } = await supabaseAdmin
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

      const { error } = await supabaseAdmin.from("leaves").insert([
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
    const { data, error } = await supabaseAdmin
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
 app.get("/api/team-leaves", authMiddleware, requireApproverRole, async (req, res) => {
  try {
    const userId = 8; // temporary
const role = "Team Lead"; //

let employeeIds = [];

// ✅ TEAM LEAD → only his team
if (role === "Team Lead") {
  const { data: team } = await supabaseAdmin
    .from("employees")
    .select("id")
   // .eq("manager_id", userId);// temporary disable

  employeeIds = team.map(e => e.id)
}
// ✅ MANAGER → all except self
else if (role === "Manager") {
  const { data: all } = await supabaseAdmin
    .from("employees")
    .select("id")
    .neq("id", userId);

  employeeIds = all.map(e => e.id)
}

// ❌ no team
if (!employeeIds.length) {
  return res.json([]);
}

// ✅ fetch leaves
const { data, error } = await supabaseAdmin
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
    const { data } = await supabaseAdmin
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
      const { data } = await supabaseAdmin
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

      const { data: existing } = await supabaseAdmin
        .from("attendance")
        .select("*")
        .eq("employee_id", req.user.id)
        .gte("punch_in", todayStart.toISOString())
        .is("punch_out", null);

      if (existing?.length > 0) {
        return res.status(400).json({ error: "Already punched in ❌" });
      }

      await supabaseAdmin.from("attendance").insert([
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

      const { data: records } = await supabaseAdmin
        .from("attendance")
        .select("*")
        .eq("employee_id", req.user.id)
        .gte("punch_in", todayStart.toISOString())
        .is("punch_out", null);

      if (!records?.length) {
        return res.status(400).json({ error: "No punch-in found ❌" });
      }

      await supabaseAdmin
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
app.put("/api/leaves/:id", authMiddleware, requireApproverRole, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // 1. get leave data
    const { data: leave } = await supabaseAdmin
      .from("leaves")
      .select("*")
      .eq("id", id)
      .single();

    if (!leave) {
      return res.status(404).json({ error: "Leave not found" });
    }

    // 2. ONLY IF APPROVED → deduct balance


if (status === "APPROVED" && leave.status !=="APPROVED") {

  const days =
  Math.ceil(
    (new Date(leave.to_date) - new Date(leave.from_date)) /
      (1000 * 60 * 60 * 24)) + 1;

  let column = "";

  if (leave.type === "CL") column = "cl";
  else if (leave.type === "SL") column = "sl";
  else column = "pl";


  const { data: emp } = await supabaseAdmin
    .from("employees")
    .select("cl, sl, pl")
    .eq("id", leave.employee_id)
    .single();


  const newBalance = Math.max((emp[column] || 0) - days, 0);


  await supabaseAdmin
    .from("employees")
    .update({ [column]: newBalance })
    .eq("id", leave.employee_id);
}


    // 3. update leave status (LAST में)
    const { data, error } = await supabaseAdmin
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
app.post("/api/upload-resume", authMiddleware, (req, res, next) => {
  upload.single("resume")(req, res, (err) => {
    if (err) {
      cleanupMulterFile(req.file);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large" });
      }
      return res.status(400).json({ error: err.message || "Invalid file" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const email = req.body.email;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);

  const pdfData = await pdfParse(dataBuffer);
const text = pdfData.text;

const objectPath = `${req.user.id}/${Date.now()}-${safeResumeFilename(req.file.originalname)}`;

const fileBuffer = fs.readFileSync(filePath);

const { error: storageError } =
  await supabaseAdmin.storage
    .from("resumes")
    .upload(objectPath, fileBuffer, {
      contentType: "application/pdf",
    });

if (storageError) {
  cleanupMulterFile(req.file);
  return res.status(500).json({
    error: storageError.message || "Resume storage upload failed",
  });
}

cleanupMulterFile(req.file);

const { data, error } = await supabaseAdmin
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


if (error) {
  return res.status(500).json({ error: error.message });
}

if (!data || !data.length) {
  return res.status(500).json({ error: "No candidate returned" });
}

return res.json({
  text,
  candidateId: data[0].id,
  publicUrl: objectPath,
  path: objectPath,
});


  } catch (err) {
    cleanupMulterFile(req.file);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/resumes/*", authMiddleware, requireApproverRole, async (req, res) => {
  try {
    const objectPath = String(req.params[0] || "").replace(/^\/+/, "");
    if (!objectPath || objectPath.includes("..")) {
      return res.status(400).json({ error: "Invalid resume path" });
    }

    const { data, error } = await supabaseAdmin.storage
      .from("resumes")
      .createSignedUrl(objectPath, 300);

    if (error || !data || !data.signedUrl) {
      return res.status(500).json({
        error: (error && error.message) || "Failed to create signed URL",
      });
    }

    return res.json({ url: data.signedUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==============================
// ATS - MATCH SCORE
// ==============================
app.post("/api/match", authMiddleware, async (req, res) => {
  try {

    const {
      text: resumeText = "",
      jobDesc = "",
      candidateId
    } = req.body || {};

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
 /*const { data: appData, error: appError } = await supabaseAdmin
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

    const { data, error } = await supabaseAdmin
    .from("candidates")
    .update({
    score: Number(score)
    })
    .eq("id", Number(candidateId))
    .select();


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
app.get("/api/candidates", authMiddleware, requireApproverRole, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
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

    const { error } = await supabaseAdmin
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
    const { data, error } = await supabaseAdmin
      .from("work_requests")
      .select("*, employees(name)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/work-request/:id", authMiddleware, requireApproverRole, async (req, res) => {
  try {
    const { status } = req.body;

    const { data: existing, error: loadError } = await supabaseAdmin
      .from("work_requests")
      .select("id, employee_id")
      .eq("id", req.params.id)
      .single();

    if (loadError || !existing) {
      return res.status(404).json({ error: "Work request not found" });
    }

    const { error } = await supabaseAdmin
      .from("work_requests")
      .update({
        status,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/applications", authMiddleware, requireApproverRole, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
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
    const { data, error } = await supabaseAdmin
      .from("employees")
      .select("*");


    if (error) throw error;

    res.json(data);
  } catch (err) {
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

    const { error } = await supabaseAdmin
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
    const { data, error } = await supabaseAdmin
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
  requireApproverRole,
  async (req, res) => {
    try {

      // 1. Fetch requests WITHOUT Supabase relationship join
      const { data: requests, error: requestError } = await supabaseAdmin
        .from("attendance_regularization")
        .select("*")
        .order("created_at", { ascending: false });

      if (requestError) {
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
      const { data: employees, error: employeeError } = await supabaseAdmin
        .from("employees")
        .select("id, name, role")
        .in("id", employeeIds);

      if (employeeError) {
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


      return res.json(result);
    } catch (err) {

      return res.status(500).json({
        error: err.message,
      });
    }
  }
);


// Manager approve/reject
app.put("/api/attendance-regularization/:id", authMiddleware, requireApproverRole, async (req, res) => {
  try {

    const { status } = req.body;

    const { data: existing, error: loadError } = await supabaseAdmin
      .from("attendance_regularization")
      .select("id, employee_id")
      .eq("id", req.params.id)
      .single();

    if (loadError || !existing) {
      return res.status(404).json({ error: "Attendance regularization not found" });
    }

    const { error } = await supabaseAdmin
      .from("attendance_regularization")
      .update({
        status,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

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

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// SEND OTP
app.post("/api/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const { data: users, error } = await supabaseAdmin
      .from("Email")
      .select("id, email")
      .eq("email", email);

    if (error) {
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

const { data, error: resendError } = await resend.emails.send({
  from: "NexusHR <onboarding@resend.dev>",
  to: [email],
  subject: "NexusHR - Password Reset OTP",
  text: `Your NexusHR password reset OTP is ${otp}. This OTP is valid for 10 minutes.`
});

if (resendError) {
    throw new Error(resendError.message || "Failed to send email");
}


res.json({
    message: "OTP sent successfully",
});

  } catch (err) {

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

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error } = await updateEmailPassword(email, hashedPassword);

    if (error) {

      return res.status(500).json({
        message: "Failed to reset password",
      });
    }

    otpStore.delete(email);

    res.json({
      message: "Password reset successfully",
    });

  } catch (err) {

    res.status(500).json({
      message: "Failed to reset password",
    });
  }
});

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
 //vedpandey