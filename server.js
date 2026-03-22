require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Razorpay = require("razorpay");
const {
  DB_PATH,
  createOrder,
  createUser,
  findOrderById,
  findUserByEmail,
  findUserByProvider,
  listOrdersByUser,
  listPaidOrders,
  updateOAuthUser,
  updateOrderPayment,
} = require("./database");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const AUTH_COOKIE = "auth_token";
const OAUTH_STATE_COOKIE = "oauth_state";
const PAYMENT_RECIPIENT = normalizeText(process.env.PAYMENT_RECIPIENT || "Shwets Coffee Shop", 120);
const ORDER_STORAGE_LABEL = normalizeText(
  process.env.ORDER_STORAGE_LABEL || `SQLite orders sheet (${path.relative(__dirname, DB_PATH)})`,
  160
);
const PAYMENT_RECIPIENT_PHONE = normalizeText(process.env.PAYMENT_RECIPIENT_PHONE || "9431505374", 30);
const PAYMENT_RECIPIENT_UPI = normalizeText(process.env.PAYMENT_RECIPIENT_UPI || "9431505374-2@axl", 120);

const razorpay =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;

const COFFEE_MENU = [
  { id: "velvet-latte", name: "Velvet Latte", category: "espresso", price: 220, roast: "Brazil + Ethiopia", accent: "Silky cocoa and caramel" },
  { id: "cloud-cappuccino", name: "Cloud Cappuccino", category: "espresso", price: 190, roast: "Colombia", accent: "Soft foam and brown sugar" },
  { id: "cedar-cold-brew", name: "Cedar Cold Brew", category: "cold", price: 240, roast: "Kenya", accent: "Cold, clean, citrus snap" },
  { id: "honey-oat-shaker", name: "Honey Oat Shaker", category: "cold", price: 260, roast: "House blend", accent: "Oat silk and honey finish" },
  { id: "cardamom-bun", name: "Cardamom Bun", category: "bakery", price: 120, roast: "Bakery", accent: "Warm spice swirl" },
  { id: "saffron-affogato", name: "Saffron Affogato", category: "dessert", price: 280, roast: "Single origin", accent: "Creamy, bright, slow finish" },
];

const SITE_CONTENT = {
  info: {
    body: "Open daily. Fast pickup. Fresh roasting. Smooth in-store service.",
  },
  contact: {
    body: "Call, mail, or walk in for orders, beans, or cafe help.",
  },
  locations: {
    body: "Visit the main bar or order ahead and pick up fast.",
  },
  faq: {
    body: "Short answers for timing, tables, and online payment.",
  },
  contactItems: [
    { label: "Phone", value: "+91 90000 11111" },
    { label: "Email", value: "hello@shwetscoffee.com" },
    { label: "Address", value: "14 Roast Street, Brew District" },
  ],
  locationsList: [
    { name: "Main Cafe", detail: "6:30 AM - 11:00 PM" },
    { name: "Pickup Counter", detail: "7:00 AM - 10:00 PM" },
  ],
};

const PROVIDER_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`,
    scope: "openid email profile",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  facebook: {
    clientId: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || `http://localhost:${PORT}/auth/facebook/callback`,
    scope: "email,public_profile",
    authUrl: "https://www.facebook.com/v23.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v23.0/oauth/access_token",
    userUrl: "https://graph.facebook.com/me?fields=id,name,email",
  },
};

app.use(cors());
app.use(express.json());

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const [key, ...rest] = part.split("=");
      cookies[key] = decodeURIComponent(rest.join("="));
      return cookies;
    }, {});
}

function setCookie(res, name, value, maxAgeMs) {
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`
  );
}

function clearCookie(res, name) {
  res.append("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function normalizeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return normalizeText(value, 254).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, provider: user.provider },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    provider: user.provider,
    createdAt: user.createdAt,
  };
}

function authTokenFromRequest(req) {
  const cookies = parseCookies(req);
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : "";
  return bearer || cookies[AUTH_COOKIE] || "";
}

function requireAuth(req, res, next) {
  const token = authTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    clearCookie(res, AUTH_COOKIE);
    return res.status(401).json({ message: "Session is invalid or expired." });
  }
}

function requirePageAuth(req, res, next) {
  const token = authTokenFromRequest(req);
  if (!token) {
    return res.redirect("/");
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    clearCookie(res, AUTH_COOKIE);
    return res.redirect("/");
  }
}

function configuredProvider(provider) {
  const config = PROVIDER_CONFIG[provider];
  return Boolean(config?.clientId && config?.clientSecret && config?.redirectUri);
}

function createState(provider) {
  return Buffer.from(
    JSON.stringify({ provider, nonce: crypto.randomBytes(16).toString("hex"), issuedAt: Date.now() }),
    "utf8"
  ).toString("base64url");
}

function validateState(req, provider, incomingState) {
  const storedState = parseCookies(req)[OAUTH_STATE_COOKIE];
  if (!storedState || !incomingState || storedState !== incomingState) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(storedState, "base64url").toString("utf8"));
    return decoded.provider === provider && Date.now() - decoded.issuedAt < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

async function exchangeCodeForToken(provider, code) {
  const config = PROVIDER_CONFIG[provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  });

  if (provider === "google") {
    params.set("grant_type", "authorization_code");
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    return response.json();
  }

  const response = await fetch(`${config.tokenUrl}?${params.toString()}`);
  return response.json();
}

async function fetchProviderProfile(provider, accessToken) {
  const config = PROVIDER_CONFIG[provider];
  const response = await fetch(config.userUrl, {
    headers: provider === "google" ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  return response.json();
}

async function findOrCreateOAuthUser(provider, profile) {
  const providerId = String(profile.sub || profile.id || "");
  const email = normalizeEmail(profile.email || `${providerId}@${provider}.local`);
  const name = normalizeText(profile.name || "Coffee Guest", 80);

  const existingProvider = findUserByProvider(provider, providerId);
  if (existingProvider) {
    return updateOAuthUser(existingProvider.id, name, email);
  }

  const existingEmail = findUserByEmail(email);
  if (existingEmail) {
    return updateOAuthUser(existingEmail.id, name, email);
  }

  return createUser({
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: null,
    provider,
    providerId,
    createdAt: new Date().toISOString(),
  });
}

function parseOrderInput(req) {
  return {
    customerName: normalizeText(req.body.customerName, 80),
    userEmail: normalizeEmail(req.auth.email),
    pickupSlot: normalizeText(req.body.pickupSlot, 40),
    tableNumber: normalizeText(req.body.tableNumber, 20),
    items: Array.isArray(req.body.items) ? req.body.items.slice(0, 25) : [],
  };
}

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = findUserByEmail(normalizeEmail(req.auth.email));
  return res.json({ user: sanitizeUser(user) });
});

app.post("/api/auth/signup", async (req, res) => {
  const name = normalizeText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const user = createUser({
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    provider: "email",
    providerId: null,
    createdAt: new Date().toISOString(),
  });

  setCookie(res, AUTH_COOKIE, createToken(user), 7 * 24 * 60 * 60 * 1000);
  return res.status(201).json({ message: "Account created successfully.", user: sanitizeUser(user) });
});

app.post("/api/auth/signin", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  const user = findUserByEmail(email);
  if (!user || !user.passwordHash) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  setCookie(res, AUTH_COOKIE, createToken(user), 7 * 24 * 60 * 60 * 1000);
  return res.json({ message: "Signed in successfully.", user: sanitizeUser(user) });
});

app.post("/api/auth/signout", (_req, res) => {
  clearCookie(res, AUTH_COOKIE);
  return res.json({ message: "Signed out." });
});

app.get("/auth/:provider", (req, res) => {
  const provider = normalizeText(req.params.provider, 20).toLowerCase();
  const config = PROVIDER_CONFIG[provider];

  if (!["google", "facebook"].includes(provider)) {
    return res.status(404).send("Provider not supported.");
  }
  if (!configuredProvider(provider)) {
    return res.status(501).send("Social login is not configured.");
  }

  const state = createState(provider);
  setCookie(res, OAUTH_STATE_COOKIE, state, 10 * 60 * 1000);

  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);

  if (provider === "google") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent");
  }

  return res.redirect(authUrl.toString());
});

app.get("/auth/:provider/callback", async (req, res) => {
  const provider = normalizeText(req.params.provider, 20).toLowerCase();
  const code = normalizeText(req.query.code, 2000);
  const state = normalizeText(req.query.state, 1000);
  const error = normalizeText(req.query.error, 200);

  if (error) {
    clearCookie(res, OAUTH_STATE_COOKIE);
    return res.redirect(`/?error=${encodeURIComponent(`${provider} login was canceled.`)}`);
  }
  if (!validateState(req, provider, state)) {
    clearCookie(res, OAUTH_STATE_COOKIE);
    return res.redirect("/?error=Invalid OAuth state. Try again.");
  }
  if (!code) {
    clearCookie(res, OAUTH_STATE_COOKIE);
    return res.redirect("/?error=Authorization code was not returned.");
  }

  try {
    const tokenPayload = await exchangeCodeForToken(provider, code);
    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      throw new Error("OAuth login failed.");
    }

    const profile = await fetchProviderProfile(provider, accessToken);
    const user = await findOrCreateOAuthUser(provider, profile);
    clearCookie(res, OAUTH_STATE_COOKIE);
    setCookie(res, AUTH_COOKIE, createToken(user), 7 * 24 * 60 * 60 * 1000);
    return res.redirect("/coffee");
  } catch {
    clearCookie(res, OAUTH_STATE_COOKIE);
    return res.redirect("/?error=OAuth login failed.");
  }
});

app.get("/api/shop", requireAuth, (_req, res) => {
  return res.json({
    brand: {
      name: "Shwets Coffee Shop",
      announcement: "Fresh coffee. Fast table service.",
    },
    menu: COFFEE_MENU,
    metrics: [
      { label: "Beans roasted weekly", value: "42kg" },
      { label: "Average pickup time", value: "08 min" },
      { label: "Signature drinks", value: "18" },
    ],
    pickupSlots: ["10 min", "15 min", "25 min", "40 min"],
    paymentEnabled: Boolean(razorpay),
    paymentGateway: razorpay ? "razorpay" : "offline",
    paymentRecipient: PAYMENT_RECIPIENT,
    paymentRecipientPhone: PAYMENT_RECIPIENT_PHONE,
    paymentRecipientUpi: PAYMENT_RECIPIENT_UPI,
    orderStorageLabel: ORDER_STORAGE_LABEL,
  });
});

app.get("/api/site-content", requireAuth, (_req, res) => {
  return res.json(SITE_CONTENT);
});

app.get("/api/orders", requireAuth, (req, res) => {
  return res.json({ orders: listOrdersByUser(normalizeEmail(req.auth.email)) });
});

app.get("/api/reception/orders", requireAuth, (_req, res) => {
  return res.json({ orders: listPaidOrders() });
});

app.post("/api/orders/checkout", requireAuth, async (req, res) => {
  if (!razorpay) {
    return res.status(501).json({ message: "Payment is not configured yet." });
  }

  const { customerName, userEmail, pickupSlot, tableNumber, items } = parseOrderInput(req);
  if (!customerName || !pickupSlot || !tableNumber || items.length === 0) {
    return res.status(400).json({ message: "Name, table number, pickup slot, and items are required." });
  }

  const menuIndex = new Map(COFFEE_MENU.map((item) => [item.id, item]));
  const normalizedItems = [];
  let totalAmount = 0;

  for (const item of items) {
    const menuItem = menuIndex.get(String(item.id || ""));
    const quantity = Number(item.quantity || 0);

    if (!menuItem || quantity < 1) {
      return res.status(400).json({ message: "Order contains an invalid item." });
    }

    const lineTotal = Number((menuItem.price * quantity).toFixed(2));
    totalAmount += lineTotal;
    normalizedItems.push({
      id: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPrice: menuItem.price,
      lineTotal,
    });
  }

  const order = createOrder({
    id: crypto.randomUUID(),
    userEmail,
    customerName,
    tableNumber,
    itemsJson: JSON.stringify(normalizedItems),
    totalAmount: Number(totalAmount.toFixed(2)),
    pickupSlot,
    paymentStatus: "pending",
    stripeSessionId: null,
    razorpayOrderId: null,
    razorpayPaymentId: null,
    createdAt: new Date().toISOString(),
  });

  const gatewayOrder = await razorpay.orders.create({
    amount: Math.round(order.totalAmount * 100),
    currency: "INR",
    receipt: order.id.slice(0, 40),
    notes: {
      appOrderId: order.id,
      customerName,
      tableNumber,
      pickupSlot,
    },
  });

  updateOrderPayment(order.id, "pending", null, gatewayOrder.id, null);

  return res.status(201).json({
    message: "Checkout started.",
    orderId: order.id,
    checkoutConfig: {
      key: process.env.RAZORPAY_KEY_ID,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      name: "Shwets Coffee Shop",
      description: `Table ${tableNumber} • ${pickupSlot}`,
      order_id: gatewayOrder.id,
      prefill: { name: customerName, email: userEmail },
      notes: {
        tableNumber,
        pickupSlot,
        paymentRecipient: PAYMENT_RECIPIENT,
        paymentRecipientPhone: PAYMENT_RECIPIENT_PHONE,
        paymentRecipientUpi: PAYMENT_RECIPIENT_UPI,
      },
      theme: { color: "#d7bf97" },
    },
  });
});

app.post("/api/orders/verify-payment", requireAuth, (req, res) => {
  if (!razorpay) {
    return res.status(501).json({ message: "Payment is not configured yet." });
  }

  const orderId = normalizeText(req.body.orderId, 80);
  const razorpayOrderId = normalizeText(req.body.razorpayOrderId, 80);
  const razorpayPaymentId = normalizeText(req.body.razorpayPaymentId, 80);
  const razorpaySignature = normalizeText(req.body.razorpaySignature, 160);
  const order = findOrderById(orderId);

  if (!order || order.userEmail !== normalizeEmail(req.auth.email)) {
    return res.status(404).json({ message: "Order not found." });
  }

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || expected !== razorpaySignature) {
    return res.status(400).json({ message: "Payment verification failed." });
  }

  const paidOrder = updateOrderPayment(orderId, "paid", null, razorpayOrderId, razorpayPaymentId);
  return res.json({
    message: `Payment received. Reception has table ${paidOrder.tableNumber}.`,
    order: paidOrder,
  });
});

app.post("/api/orders", requireAuth, (req, res) => {
  const { customerName, userEmail, pickupSlot, tableNumber, items } = parseOrderInput(req);
  if (!customerName || !pickupSlot || !tableNumber || items.length === 0) {
    return res.status(400).json({ message: "Name, table number, pickup slot, and items are required." });
  }

  const menuIndex = new Map(COFFEE_MENU.map((item) => [item.id, item]));
  const normalizedItems = [];
  let totalAmount = 0;

  for (const item of items) {
    const menuItem = menuIndex.get(String(item.id || ""));
    const quantity = Number(item.quantity || 0);

    if (!menuItem || quantity < 1) {
      return res.status(400).json({ message: "Order contains an invalid item." });
    }

    const lineTotal = Number((menuItem.price * quantity).toFixed(2));
    totalAmount += lineTotal;
    normalizedItems.push({
      id: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPrice: menuItem.price,
      lineTotal,
    });
  }

  const order = createOrder({
    id: crypto.randomUUID(),
    userEmail,
    customerName,
    tableNumber,
    itemsJson: JSON.stringify(normalizedItems),
    totalAmount: Number(totalAmount.toFixed(2)),
    pickupSlot,
    paymentStatus: "paid",
    stripeSessionId: null,
    razorpayOrderId: null,
    razorpayPaymentId: null,
    createdAt: new Date().toISOString(),
  });

  return res.status(201).json({ message: `Order confirmed for ${pickupSlot}.`, order });
});

app.get("/coffee", requirePageAuth, (_req, res) => {
  return res.sendFile(path.join(__dirname, "coffee.html"));
});

app.use(express.static(__dirname));

app.use((_req, res) => {
  return res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  if (JWT_SECRET === "dev-secret-change-me") {
    console.warn("Warning: JWT_SECRET is using the default value. Set a strong secret in .env.");
  }
  console.log(`Auth app listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`App URL: ${APP_URL}`);
});
