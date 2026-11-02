
const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const {
  KICK_CLIENT_ID,
  KICK_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
} = process.env;

const REDIRECT_URI =
  "https://6syz62kqn9.onrender.com/auth/kick/callback";

if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
  throw new Error("Kick environment variables are missing");
}

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
);

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto
    .createHmac("sha256", KICK_CLIENT_SECRET)
    .update(value)
    .digest("base64url");
}

function makeCookie(res, name, value, maxAge) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge
  });
}

function verifyCookie(value) {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = sign(payload);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString()
    );
  } catch {
    return null;
  }
}

// Start Kick login
app.get("/auth/kick", (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const payload = base64url(JSON.stringify({
    state,
    verifier,
    created: Date.now()
  }));

  makeCookie(
    res,
    "kick_oauth",
    payload + "." + sign(payload),
    10 * 60 * 1000
  );

  const params = new URLSearchParams({
    client_id: KICK_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "user:read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  res.redirect(
    "https://id.kick.com/oauth/authorize?" +
    params.toString()
  );
});

// Kick returns the visitor here
app.get("/auth/kick/callback", async (req, res) => {
  try {
    const saved = verifyCookie(req.headers.cookie
      ?.split("; ")
      .find(c => c.startsWith("kick_oauth="))
      ?.split("=")
      .slice(1)
      .join("="));

    const code = req.query.code;
    const state = req.query.state;

    if (
      !saved ||
      !code ||
      !state ||
      state !== saved.state ||
      Date.now() - saved.created > 10 * 60 * 1000
    ) {
      return res.status(400).send("Invalid Kick login. Try again.");
    }

    const tokenResponse = await fetch(
      "https://id.kick.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: KICK_CLIENT_ID,
          client_secret: KICK_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code_verifier: saved.verifier,
          code
        })
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Kick token exchange failed");
      return res.status(400).send("Kick authorization failed.");
    }

    const userResponse = await fetch(
      "https://api.kick.com/public/v1/users",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`
        }
      }
    );

    const userResult = await userResponse.json();

    if (!userResponse.ok || !userResult.data?.length) {
      console.error("Could not retrieve Kick user");
      return res.status(400).send("Could not read Kick account.");
    }

    const user = userResult.data[0];

    const profile = {
      id: user.user_id,
      name: user.name,
      username: user.name,
      avatar: user.profile_picture
    };

    const payload = base64url(JSON.stringify(profile));

    makeCookie(
      res,
      "kick_user",
      payload + "." + sign(payload),
      7 * 24 * 60 * 60 * 1000
    );

    res.clearCookie("kick_oauth", { path: "/" });

    res.redirect("/?kick=connected");

  } catch (error) {
    console.error("Kick login error:", error.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

// Return the logged-in visitor's profile
app.get("/api/me", (req, res) => {
  const rawCookie = req.headers.cookie
    ?.split("; ")
    .find(c => c.startsWith("kick_user="))
    ?.split("=")
    .slice(1)
    .join("=");

  const user = verifyCookie(rawCookie);

  if (!user) {
    return res.status(401).json({
      connected: false
    });
  }

  res.json({
    connected: true,
    user
  });
});

// Disconnect Kick
app.post("/auth/kick/logout", (req, res) => {
  res.clearCookie("kick_user", { path: "/" });
  res.json({ success: true });
});

// Existing leaderboard
app.get("/api/leaderboard", async (req, res) => {
  const { data, error } = await supabase
    .from("members")
    .select("name, points, avatar_url")
    .order("points", { ascending: false })
    .limit(3);

  if (error) {
    console.error(error.message);
    return res.status(500).json({ members: [] });
  }

  res.json({
    members: (data || []).map(member => ({
      name: member.name,
      points: member.points,
      avatarUrl: member.avatar_url
    }))
  });
});

// Existing reports
app.post("/api/reports", async (req, res) => {
  const { name, type, message } = req.body;

  const { error } = await supabase
    .from("reports")
    .insert([{ name, type, message }]);

  if (error) {
    console.error(error.message);
    return res.status(500).json({ success: false });
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("MY COMMUNITY server running on port " + PORT);
});

