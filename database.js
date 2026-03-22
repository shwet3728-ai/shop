const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "auth.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    table_number TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total_amount REAL NOT NULL,
    pickup_slot TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    stripe_session_id TEXT,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    created_at TEXT NOT NULL
  );
`);

function mapUser(row) {
  return row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        passwordHash: row.password_hash,
        provider: row.provider,
        providerId: row.provider_id,
        createdAt: row.created_at,
      }
    : null;
}

function mapOrder(row) {
  return row
    ? {
        id: row.id,
        userEmail: row.user_email,
        customerName: row.customer_name,
        tableNumber: row.table_number,
        items: JSON.parse(row.items_json),
        totalAmount: row.total_amount,
        pickupSlot: row.pickup_slot,
        paymentStatus: row.payment_status,
        stripeSessionId: row.stripe_session_id,
        razorpayOrderId: row.razorpay_order_id,
        razorpayPaymentId: row.razorpay_payment_id,
        createdAt: row.created_at,
      }
    : null;
}

function createUser(user) {
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, provider, provider_id, created_at)
     VALUES (@id, @name, @email, @passwordHash, @provider, @providerId, @createdAt)`
  ).run(user);
  return findUserByEmail(user.email);
}

function findUserByEmail(email) {
  return mapUser(db.prepare("SELECT * FROM users WHERE email = ?").get(email));
}

function findUserByProvider(provider, providerId) {
  return mapUser(
    db.prepare("SELECT * FROM users WHERE provider = ? AND provider_id = ?").get(provider, providerId)
  );
}

function updateOAuthUser(id, name, email) {
  db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name, email, id);
  return findUserByEmail(email);
}

function createOrder(order) {
  db.prepare(
    `INSERT INTO orders (
      id, user_email, customer_name, table_number, items_json, total_amount,
      pickup_slot, payment_status, stripe_session_id, razorpay_order_id,
      razorpay_payment_id, created_at
    ) VALUES (
      @id, @userEmail, @customerName, @tableNumber, @itemsJson, @totalAmount,
      @pickupSlot, @paymentStatus, @stripeSessionId, @razorpayOrderId,
      @razorpayPaymentId, @createdAt
    )`
  ).run(order);
  return findOrderById(order.id);
}

function findOrderById(id) {
  return mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
}

function updateOrderPayment(id, paymentStatus, stripeSessionId = null, razorpayOrderId = null, razorpayPaymentId = null) {
  db.prepare(
    `UPDATE orders
     SET payment_status = ?, stripe_session_id = ?, razorpay_order_id = ?, razorpay_payment_id = ?
     WHERE id = ?`
  ).run(paymentStatus, stripeSessionId, razorpayOrderId, razorpayPaymentId, id);
  return findOrderById(id);
}

function listOrdersByUser(email) {
  return db
    .prepare("SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC")
    .all(email)
    .map(mapOrder);
}

function listPaidOrders() {
  return db
    .prepare("SELECT * FROM orders WHERE payment_status = 'paid' ORDER BY created_at DESC")
    .all()
    .map(mapOrder);
}

module.exports = {
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
};
