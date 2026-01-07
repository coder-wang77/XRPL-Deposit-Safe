import express from "express";
import cors from "cors";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: "http://127.0.0.1:5501",
    credentials: true,
  })
);

// health check
app.get("/health", (req, res) => {
  res.send("Server is running");
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // demo login (no DB yet)
  res.json({
    ok: true,
    user: { email },
  });
});

// SIGNUP
app.post("/api/signup", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // demo signup (no DB yet)
  res.json({
    ok: true,
    user: { email },
  });
});

app.listen(3001, () => {
  console.log("Backend running at http://localhost:3001");
});

