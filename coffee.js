const API_BASE = `${window.location.origin}/api`;
const cart = new Map();
const mascotLines = [
  "Best brew, short wait.",
  "Fresh cup, clean mood.",
  "Picked a good one.",
  "Reception has it.",
];

const icons = {
  espresso: "☕",
  cold: "🥤",
  dessert: "🍨",
  bakery: "🥐",
};

const elements = {
  loadingScreen: document.getElementById("loading-screen"),
  loadingButton: document.getElementById("loading-button"),
  welcomeLine: document.getElementById("welcome-line"),
  signoutButton: document.getElementById("signout-button"),
  heroTitle: document.getElementById("hero-title"),
  heroCopy: document.getElementById("hero-copy"),
  announcementLine: document.getElementById("announcement-line"),
  companion: document.getElementById("companion"),
  companionBubble: document.getElementById("companion-bubble"),
  menuSearch: document.getElementById("menu-search"),
  menuPrev: document.getElementById("menu-prev"),
  menuNext: document.getElementById("menu-next"),
  menuRow: document.getElementById("menu-row"),
  cartItems: document.getElementById("cart-items"),
  cartCount: document.getElementById("cart-count"),
  orderForm: document.getElementById("order-form"),
  customerName: document.getElementById("customer-name"),
  tableNumber: document.getElementById("table-number"),
  pickupSlot: document.getElementById("pickup-slot"),
  orderStatus: document.getElementById("order-status"),
  payButton: document.getElementById("pay-button"),
  paymentRecipient: document.getElementById("payment-recipient"),
  paymentRecipientUpi: document.getElementById("payment-recipient-upi"),
  orderStorage: document.getElementById("order-storage"),
  ordersSheetBody: document.getElementById("orders-sheet-body"),
  ordersSheetEmpty: document.getElementById("orders-sheet-empty"),
  infoCopy: document.getElementById("info-copy"),
  infoPills: document.getElementById("info-pills"),
  contactCopy: document.getElementById("contact-copy"),
  contactList: document.getElementById("contact-list"),
  locationsCopy: document.getElementById("locations-copy"),
  locationsList: document.getElementById("locations-list"),
  faqCopy: document.getElementById("faq-copy"),
  faqList: document.getElementById("faq-list"),
};

let shopData = null;
let siteContent = null;
let filteredItems = [];
let session = null;

const faqItems = [
  { question: "Can I order from my table?", answer: "Yes. Add your table number and send the order." },
  { question: "How fast is pickup?", answer: "Usually within the pickup time you select." },
  { question: "Can I pay online?", answer: "Yes. Razorpay checkout opens when payment is enabled." },
];

function hideLoader() {
  elements.loadingScreen.classList.add("hidden");
}

function bindLoader() {
  elements.loadingButton.addEventListener("click", hideLoader, { once: true });
  window.setTimeout(hideLoader, 2200);
}

function trackEyes(event) {
  document.querySelectorAll(".bean-eye span, .companion-eye span").forEach((pupil) => {
    const rect = pupil.parentElement.getBoundingClientRect();
    const dx = Math.max(-4, Math.min(4, (event.clientX - (rect.left + rect.width / 2)) / 14));
    const dy = Math.max(-4, Math.min(4, (event.clientY - (rect.top + rect.height / 2)) / 14));
    pupil.style.transform = `translate(${dx}px, ${dy}px)`;
  });
}

function setMascotLine(line) {
  elements.companionBubble.textContent = line;
}

async function loadSession() {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: "same-origin" });
  if (!response.ok) {
    window.location.href = "/";
    return false;
  }

  const payload = await response.json();
  session = { user: payload.user };
  elements.welcomeLine.textContent = payload.user.name;
  elements.customerName.value = payload.user.name;
  return true;
}

async function verifyRazorpayPayment(orderId, paymentResponse) {
  const response = await fetch(`${API_BASE}/orders/verify-payment`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      razorpayOrderId: paymentResponse.razorpay_order_id,
      razorpayPaymentId: paymentResponse.razorpay_payment_id,
      razorpaySignature: paymentResponse.razorpay_signature,
    }),
  });
  return response.json();
}

function renderHero(data) {
  elements.heroTitle.textContent = "The best quality coffee for your best brew.";
  elements.heroCopy.textContent = "Strong coffee. Fast service.";
  elements.announcementLine.textContent = data.brand.announcement;
}

function renderMenu(items) {
  elements.menuRow.innerHTML = items
    .map(
      (item) => `
        <article class="menu-card">
          <div class="product-visual">${icons[item.category] || "☕"}</div>
          <div>
            <strong class="price">₹${item.price.toFixed(0)}</strong>
            <h3>${item.name}</h3>
            <p class="meta">${item.accent}</p>
            <div class="card-actions">
              <span>${item.roast}</span>
              <button class="primary-button add-button" type="button" data-id="${item.id}">
                ${cart.has(item.id) ? "Add more" : "Add"}
              </button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  elements.menuRow.querySelectorAll(".add-button").forEach((button) => {
    button.addEventListener("click", () => {
      const next = (cart.get(button.dataset.id) || 0) + 1;
      cart.set(button.dataset.id, next);
      renderCart();
      renderMenu(filteredItems);
      setMascotLine(mascotLines[2]);
    });
  });
}

function renderBottomSections() {
  if (!siteContent || !shopData) {
    return;
  }

  elements.infoCopy.textContent = siteContent.info.body;
  elements.contactCopy.textContent = siteContent.contact.body;
  elements.locationsCopy.textContent = siteContent.locations.body;
  elements.faqCopy.textContent = siteContent.faq.body;

  elements.infoPills.innerHTML = shopData.metrics
    .map((metric) => `<div class="info-pill"><strong>${metric.value}</strong><span>${metric.label}</span></div>`)
    .join("");

  elements.contactList.innerHTML = siteContent.contactItems
    .map((item) => `<div class="detail-card"><strong>${item.label}</strong><span>${item.value}</span></div>`)
    .join("");

  elements.locationsList.innerHTML = siteContent.locationsList
    .map((item) => `<div class="detail-card"><strong>${item.name}</strong><span>${item.detail}</span></div>`)
    .join("");

  elements.faqList.innerHTML = faqItems
    .map((item) => `<div class="faq-item"><strong>${item.question}</strong><span>${item.answer}</span></div>`)
    .join("");
}

function formatOrderItems(items) {
  return items.map((item) => `${item.name} x${item.quantity}`).join(", ");
}

function renderOrdersSheet(orders) {
  if (!orders.length) {
    elements.ordersSheetBody.innerHTML = "";
    elements.ordersSheetEmpty.hidden = false;
    return;
  }

  elements.ordersSheetEmpty.hidden = true;
  elements.ordersSheetBody.innerHTML = orders
    .map(
      (order) => `
        <tr>
          <td>${new Date(order.createdAt).toLocaleString()}</td>
          <td>${formatOrderItems(order.items)}</td>
          <td>₹${Number(order.totalAmount).toFixed(0)}</td>
          <td>${order.tableNumber}</td>
          <td>${order.pickupSlot}</td>
          <td><span class="status-badge status-${order.paymentStatus}">${order.paymentStatus}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderCart() {
  const entries = [...cart.entries()].map(([id, quantity]) => {
    const item = shopData.menu.find((menuItem) => menuItem.id === id);
    return `
      <div class="cart-pill" data-id="${id}">
        <strong>${item.name}</strong>
        <span>${quantity}x</span>
        <div class="cart-pill-actions">
          <button class="cart-action" type="button" data-action="decrease" data-id="${id}">-</button>
          <button class="cart-action" type="button" data-action="increase" data-id="${id}">+</button>
          <button class="cart-action remove" type="button" data-action="remove" data-id="${id}">x</button>
        </div>
      </div>
    `;
  });

  const count = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  elements.cartCount.textContent = `${count} items`;
  elements.cartItems.innerHTML = entries.length ? entries.join("") : `<span class="cart-pill">Cart is empty</span>`;

  elements.cartItems.querySelectorAll(".cart-action").forEach((button) => {
    button.addEventListener("click", () => {
      const { id, action } = button.dataset;
      const current = cart.get(id) || 0;

      if (action === "increase") {
        cart.set(id, current + 1);
      } else if (action === "decrease") {
        if (current <= 1) {
          cart.delete(id);
        } else {
          cart.set(id, current - 1);
        }
      } else if (action === "remove") {
        cart.delete(id);
      }

      renderCart();
      renderMenu(filteredItems);
    });
  });
}

function filterMenu() {
  const query = elements.menuSearch.value.trim().toLowerCase();
  filteredItems = shopData.menu.filter((item) => item.name.toLowerCase().includes(query) || item.accent.toLowerCase().includes(query));
  renderMenu(filteredItems);
}

function scrollMenu(direction) {
  const amount = Math.min(elements.menuRow.clientWidth * 0.8, 420);
  elements.menuRow.scrollBy({ left: direction * amount, behavior: "smooth" });
}

async function submitOrder(event) {
  event.preventDefault();

  const items = [...cart.entries()].map(([id, quantity]) => ({ id, quantity }));
  if (!items.length) {
    elements.orderStatus.textContent = "Add items first.";
    return;
  }

  const endpoint = shopData.paymentEnabled ? "orders/checkout" : "orders";
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: elements.customerName.value.trim() || session.user.name,
      tableNumber: elements.tableNumber.value.trim(),
      pickupSlot: elements.pickupSlot.value,
      items,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    elements.orderStatus.textContent = payload.message || "Order failed.";
    return;
  }

  if (shopData.paymentEnabled && window.Razorpay) {
    const checkout = new window.Razorpay({
      ...payload.checkoutConfig,
      handler: async (paymentResponse) => {
        const verification = await verifyRazorpayPayment(payload.orderId, paymentResponse);
        if (verification.order) {
          elements.orderStatus.textContent = verification.message;
          cart.clear();
          renderCart();
          renderMenu(filteredItems);
          await loadOrders();
          setMascotLine(mascotLines[3]);
          return;
        }
        elements.orderStatus.textContent = verification.message || "Payment verification failed.";
      },
      modal: {
        ondismiss: () => {
          elements.orderStatus.textContent = "Payment cancelled.";
        },
      },
    });
    checkout.open();
    return;
  }

  elements.orderStatus.textContent = `${payload.message} Reception has table ${payload.order.tableNumber}.`;
  cart.clear();
  renderCart();
  renderMenu(filteredItems);
  await loadOrders();
  setMascotLine(mascotLines[3]);
}

async function loadShop() {
  const response = await fetch(`${API_BASE}/shop`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error("Unable to load shop.");
  }

  shopData = payload;
  filteredItems = payload.menu.slice();
  document.title = payload.brand.name;
  renderHero(payload);
  renderMenu(filteredItems);
  renderCart();
  elements.pickupSlot.innerHTML = payload.pickupSlots.map((slot) => `<option value="${slot}">${slot}</option>`).join("");
  elements.paymentRecipient.textContent = payload.paymentRecipient;
  elements.paymentRecipientUpi.textContent = `${payload.paymentRecipientUpi} • ${payload.paymentRecipientPhone}`;
  elements.orderStorage.textContent = payload.orderStorageLabel;
  if (!payload.paymentEnabled) {
    elements.payButton.textContent = "Place order";
  }
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/orders`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Unable to load stored orders.");
  }
  renderOrdersSheet(payload.orders || []);
}

async function loadSiteContent() {
  const response = await fetch(`${API_BASE}/site-content`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error("Unable to load sections.");
  }
  siteContent = payload;
  renderBottomSections();
}

function bindEvents() {
  document.addEventListener("pointermove", trackEyes);
  elements.companion.addEventListener("click", () => setMascotLine(mascotLines[1]));
  elements.menuSearch.addEventListener("input", filterMenu);
  elements.menuPrev.addEventListener("click", () => scrollMenu(-1));
  elements.menuNext.addEventListener("click", () => scrollMenu(1));
  elements.orderForm.addEventListener("submit", (event) => {
    submitOrder(event).catch((error) => {
      elements.orderStatus.textContent = error.message;
    });
  });
  elements.signoutButton.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/auth/signout`, { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = "/";
    }
  });
}

async function init() {
  bindLoader();
  if (!(await loadSession())) {
    return;
  }
  bindEvents();
  await loadShop();
  await loadSiteContent();
  await loadOrders();
  setMascotLine(mascotLines[0]);
}

init().catch((error) => {
  elements.orderStatus.textContent = error.message;
});
