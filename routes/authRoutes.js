const express = require("express");

module.exports = (
  supabase,
  jwt,
  JWT_SECRET,
  normalizeRole,
  transporter
) => {
  const router = express.Router();

  router.post("/login", async (req, res) => {
  console.log("LOGIN HIT");
  console.log(req.body);
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

      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.json({
        token,
        user: payload,
      });
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  });
// ===============================
// FORGOT PASSWORD
// ===============================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const { data: user, error } = await supabase
      .from("Email")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "Email not found"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

console.log("Generated OTP:", otp);
console.log("Sending OTP:", otp);

const { error: updateError } = await supabase
  .from("Email")
  .update({
    reset_otp: otp,
    otp_expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  .eq("id", user.id);
const { data: checkUser, error: checkError } = await supabase
  .from("Email")
  .select("reset_otp, otp_expiry")
  .eq("id", user.id)
  .single();

console.log("Check Error:", checkError);
console.log("DB After Update:", checkUser);

console.log("User ID:", user.id);
console.log("Update Error:", updateError);
console.log("Mail OTP:", otp);

await transporter.sendMail({      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "NexusHR Password Reset OTP",
      html: `
        <h2>Password Reset</h2>
        <p>Your OTP is:</p>
        <h1>${otp}</h1>
        <p>Valid for 10 minutes.</p>
      `
    });

    res.json({
      success: true,
      message: "OTP sent successfully"
    });    
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
  
// ===============================
// VERIFY OTP
// ===============================
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const { data: user, error } = await supabase
      .from("Email")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
console.log("Entered OTP:", otp);
console.log("DB OTP:", user.reset_otp);
console.log("OTP Type:", typeof otp);
console.log("DB Type:", typeof user.reset_otp);
    if (String(user.reset_otp) !== String(otp)) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
const expiry = new Date(user.otp_expiry);
const now = new Date();

console.log("Expiry Date:", expiry);
console.log("Now Date:", now);
console.log("Expiry ms:", expiry.getTime());
console.log("Now ms:", now.getTime());
console.log("Expired:", expiry.getTime() < now.getTime());

if (expiry.getTime() < now.getTime()) {
  return res.status(400).json({
    success: false,
    message: "OTP expired",
  });
}

    res.json({
      success: true,
      message: "OTP verified"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
// ===============================
// RESET PASSWORD
// ===============================
router.post("/reset-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { error } = await supabase
      .from("Email")
      .update({
        password: password,
        reset_otp: null,
        otp_expiry: null
      })
      .eq("email", email);

    if (error) throw error;

    res.json({
      success: true,
      message: "Password updated successfully"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
return router;
};
//VedPandey