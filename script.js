const modeButtons = document.querySelectorAll(".mode-button");
const authCard = document.querySelector(".auth-card");
const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const submitButton = document.getElementById("submit-button");
const checkboxLabel = document.getElementById("checkbox-label");
const statusMessage = document.getElementById("status-message");
const sessionMessage = document.getElementById("session-message");
const auxLink = document.getElementById("aux-link");
const sceneNote = document.getElementById("scene-note");
const form = document.getElementById("auth-form");
const socialButtons = document.querySelectorAll(".social-button");
const eyePupils = document.querySelectorAll(".bean-eye span");
const API_BASE = `${window.location.origin}/api`;
const sceneMessages = [
  "Bean is watching. Rabbit is collecting coffee.",
  "Fresh cups are moving to your table.",
  "Login first. Then the coffee starts.",
];
let sceneIndex = 0;

function setMode(mode) {
  const isSignup = mode === "signup";
  authCard.classList.toggle("signup-mode", isSignup);
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  formTitle.textContent = isSignup ? "Create account" : "Sign in";
  formSubtitle.textContent = isSignup ? "Sign up with social login or your email." : "Continue with your preferred method.";
  submitButton.textContent = isSignup ? "Create account" : "Sign in with email";
  checkboxLabel.textContent = isSignup ? "I agree to the terms" : "Remember me";
  auxLink.textContent = isSignup ? "" : "Forgot password?";
  form.reset();
  statusMessage.textContent = "";
  sessionMessage.textContent = "";
}

function showSession(user) {
  sessionMessage.textContent = `Authenticated as ${user.name} (${user.email}) via ${user.provider}.`;
}

function trackBeanEyes(event) {
  eyePupils.forEach((pupil) => {
    const rect = pupil.parentElement.getBoundingClientRect();
    const dx = Math.max(-4, Math.min(4, (event.clientX - (rect.left + rect.width / 2)) / 14));
    const dy = Math.max(-4, Math.min(4, (event.clientY - (rect.top + rect.height / 2)) / 14));
    pupil.style.transform = `translate(${dx}px, ${dy}px)`;
  });
}

function rotateSceneNote() {
  sceneIndex = (sceneIndex + 1) % sceneMessages.length;
  sceneNote.textContent = sceneMessages[sceneIndex];
}

function goToCoffeeShop() {
  window.location.href = `${window.location.origin}/coffee`;
}

function hydrateSessionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  if (error) {
    statusMessage.textContent = error;
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function redirectIfAuthenticated() {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, { credentials: "same-origin" });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload?.user) {
      showSession(payload.user);
      goToCoffeeShop();
    }
  } catch {
    // Ignore auth probe failures on login page.
  }
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.addEventListener("pointermove", trackBeanEyes);

socialButtons.forEach((button) => {
  button.addEventListener("mouseenter", () => {
    sceneNote.textContent = `Coffee bean approves ${button.dataset.provider}. Rabbit keeps collecting cups.`;
  });
  button.addEventListener("click", () => {
    statusMessage.textContent = "";
    sessionMessage.textContent = "";
    window.location.href = `${window.location.origin}/auth/${button.dataset.provider}`;
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const isSignup = authCard.classList.contains("signup-mode");
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const name = String(formData.get("name") || "").trim();
  const endpoint = isSignup ? "signup" : "signin";
  const body = isSignup ? { name, email, password } : { email, password };

  statusMessage.textContent = "";
  sessionMessage.textContent = "";

  if (!email || !password) {
    statusMessage.textContent = "Enter both email and password.";
    return;
  }
  if (isSignup && !name) {
    statusMessage.textContent = "Enter your full name to create an account.";
    return;
  }
  if (isSignup && password !== confirmPassword) {
    statusMessage.textContent = "Passwords do not match.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/${endpoint}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    if (!response.ok) {
      statusMessage.textContent = payload.message || "Authentication failed.";
      return;
    }

    sceneNote.textContent = "Perfect. The coffee room is ready for you.";
    goToCoffeeShop();
  } catch {
    statusMessage.textContent = "Backend is not reachable. Start the server and try again.";
  }
});

hydrateSessionFromUrl();
redirectIfAuthenticated();
window.setInterval(rotateSceneNote, 2800);
