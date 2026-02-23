// assets/js/admin.js
// Simple client-side "admin login" (UI gating only, NOT secure).
// - Credentials hardcoded as requested.
// - State stored in localStorage (expires).
// - Enables Export CSV on device.html (if present).

(function () {
  const STORAGE_KEY = "salinity_admin_session_v2";
  const SESSION_HOURS = 12;

  const ADMINS = [
    { account: "admin1", password: "12345678" },
    { account: "admin2", password: "123456789" },
  ];

  function nowMs() { return Date.now(); }

  function getSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s?.account || !s?.createdAt) return null;

      const ageMs = nowMs() - Number(s.createdAt);
      if (ageMs > SESSION_HOURS * 3600 * 1000) return null;
      return s;
    } catch {
      return null;
    }
  }

  function setSession(account) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ account, createdAt: nowMs() }));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isAuthed() { return !!getSession(); }

  function updateExportUi() {
    const exportBtn = document.getElementById("exportCsvBtn");
    if (exportBtn) exportBtn.style.display = isAuthed() ? "inline-flex" : "none";
  }

  // ===== Admin page (admin.html) =====
function updateAdminPageUi() {
  const msg = document.getElementById("adminMsg");
  const form = document.getElementById("adminLoginForm");
  const actions = document.getElementById("adminLoggedInActions");
  const title = document.getElementById("adminTitle");
  const s = getSession();

  if (!form && !actions) return;

  if (s) {
    if (form) form.style.display = "none";
    if (actions) actions.style.display = "grid";
    if (msg) msg.textContent = "";
    if (title) title.textContent = "Đăng nhập thành công";
  } else {
    if (form) form.style.display = "grid";
    if (actions) actions.style.display = "none";
    if (msg) msg.textContent = "";
    if (title) title.textContent = "Đăng nhập tài khoản admin";
  }
}

  function bindAdminForm() {
    const form = document.getElementById("adminLoginForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const account = String(document.getElementById("adminAccount")?.value || "").trim();
      const password = String(document.getElementById("adminPassword")?.value || "");

      const ok = ADMINS.some((a) => a.account === account && a.password === password);
      const msg = document.getElementById("adminMsg");

      if (!ok) {
        if (msg) msg.textContent = "Tài khoản/ mật khẩu không đúng.";
        return;
      }

      setSession(account);

      // Redirect to home page after successful login
      window.location.href = "index.html";
    });
  }

  function bindAdminActions() {
    const goHomeBtn = document.getElementById("goHomeBtn");
    if (goHomeBtn) {
      goHomeBtn.addEventListener("click", () => {
        window.location.href = "index.html";
      });
    }

    const logoutBtn = document.getElementById("adminLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        clearSession();
        updateAdminPageUi();
        updateExportUi();
      });
    }
  }

  // ===== CSV export (device.html) =====
  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportDeviceTableCsv() {
    const tbody = document.getElementById("detailTableBody");
    const sel = document.getElementById("detailDeviceSelect");
    if (!tbody || !sel) return;

    const deviceId = sel.value || "device";
    const rows = Array.from(tbody.querySelectorAll("tr"));
    if (!rows.length) {
      alert("Không có dữ liệu để export.");
      return;
    }

    const header = ["Thời gian đo", "Ngày đo", "Độ mặn (‰)", "pH", "Nhiệt độ (°C)", "Voltage (V)", "Pin (%)"];
    const csvRows = [header];

    rows.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
        String(td.textContent || "").trim().replaceAll('"', '""')
      );
      csvRows.push(cells.map((c) => `"${c}"`));
    });

    const csvText = csvRows.map((r) => r.join(",")).join("\n");
    const ts = new Date();
    const stamp = ts.toISOString().slice(0, 19).replaceAll(":", "-");
    downloadTextFile(`${deviceId}_history_${stamp}.csv`, csvText);
  }

  function bindExportBtn() {
    const exportBtn = document.getElementById("exportCsvBtn");
    if (!exportBtn) return;

    exportBtn.addEventListener("click", () => {
      if (!isAuthed()) {
        alert("Bạn cần đăng nhập admin để export.");
        return;
      }
      exportDeviceTableCsv();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Expire session if needed
    if (!getSession()) clearSession();

    bindAdminForm();
    bindAdminActions();
    bindExportBtn();
    updateAdminPageUi();
    updateExportUi();
  });

  window.AdminAuth = { isAuthed };
})();