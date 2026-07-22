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
      .from("employees")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "Email not found"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await supabase
      .from("employees")
      .update({
        reset_otp: otp,
        otp_expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })
      .eq("id", user.id);

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
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
  return router;
};
