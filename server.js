  require("dotenv").config();

  const express = require("express");
  const app = express();
  const cors = require("cors");
  const jwt = require("jsonwebtoken");
  const { createClient } = require("@supabase/supabase-js");
  const multer = require("multer");
  const pdfParse = require("pdf-parse");
  const fs = require("fs");
  const upload = multer({ dest: "uploads/" });
  const nodemailer = require("nodemailer");

  // Configure nodemailer
  const transport = nodemailer.createTransport({ 
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

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
 const authRoutes = require("./routes/authRoutes");

app.use(
  "/api",
  authRoutes(
  supabase,
  jwt,
  JWT_SECRET,
  normalizeRole,
  transport
)
);

  // ==============================
  // APPLY LEAVE
  // ==============================
const leaveRoutes = require("./routes/leaveRoutes");

app.use(
  "/api",
  leaveRoutes(supabase, authMiddleware)
);

  // ==============================
  // ATTENDANCE ROUTES (🔥 MAIN FIX)
  // ==============================
const attendanceRoutes = require("./routes/attendanceRoutes");

app.use(
  "/api",
  attendanceRoutes(supabase, authMiddleware)
);

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
const employeeRoutes = require("./routes/employeeRoutes");

app.use(
  "/api",
  employeeRoutes(supabase, authMiddleware)
);
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

    const { data: request, error: requestError } = await supabase
      .from("attendance_regularization")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (requestError) throw requestError;

    if (status === "APPROVED") {
      const start = `${request.attendance_date}T00:00:00.000Z`;
      const end = `${request.attendance_date}T23:59:59.999Z`;

      const { data: attendance, error: attendanceError } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", request.employee_id)
        .gte("punch_in", start)
        .lte("punch_in", end)
        .order("punch_in", { ascending: true })
        .limit(1);

      if (attendanceError) throw attendanceError;

      if (attendance?.length) {
        const { error: updateAttendanceError } = await supabase
          .from("attendance")
          .update({
            punch_in: request.new_punch_in,
            punch_out: request.new_punch_out,
          })
          .eq("id", attendance[0].id);

        if (updateAttendanceError) throw updateAttendanceError;
      } else {
        const { error: insertAttendanceError } = await supabase
          .from("attendance")
          .insert({
            employee_id: request.employee_id,
            punch_in: request.new_punch_in,
            punch_out: request.new_punch_out,
          });

        if (insertAttendanceError) throw insertAttendanceError;
      }
    }

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
    console.log("REGULARIZATION ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
 //vedpandey