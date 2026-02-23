// assets/js/admin.js
// Simple client-side "admin login" (NOTE: only for UI gating, NOT secure).
// - Credentials hardcoded as requested.
// - State stored in localStorage.
// - Adds: Export CSV button on device.html (if present).
//
// IMPORTANT:
// This does NOT grant Firestore write permissions. For add/delete devices securely,
// you must use Firebase Auth + Firestore Security Rules.

(function () {
  const STORAGE_KEY = "salinity_admin_session_v1";
  const SESSION_HOURS = 12;

  const ADMINS = [
    { account: "admin1", password: "12345678" },
    { account: "admin2", password: "123456789" },
  ];

  function nowMs() {
    return Date.now();
  }

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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ account, createdAt: nowMs() })
    );
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isAuthed() {
    return !!getSession();
  }

  function updateAdminUi() {
    const btn = document.getElementById("adminBtn");
    const exportBtn = document.getElementById("exportCsvBtn");

    if (btn) btn.textContent = isAuthed() ? "Logout" : "Admin";

    // Gate export button
    if (exportBtn) {
      exportBtn.style.display = isAuthed() ? "inline-flex" : "none";
    }
  }

  function loginFlow() {
    const account = window.prompt("Admin account:");
    if (!account) return;

    const password = window.prompt("Password:");
    if (password == null) return;

    const ok = ADMINS.some(
      (a) => a.account === String(account).trim() && a.password === String(password)
    );

    if (!ok) {
      alert("Sai tài khoản hoặc mật khẩu.");
      return;
    }

    setSession(String(account).trim());
    updateAdminUi();
    alert("Đăng nhập admin thành công.");
  }

  function logoutFlow() {
    clearSession();
    updateAdminUi();
    alert("Đã logout.");
  }

  function bindAdminBtn() {
    const btn = document.getElementById("adminBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      if (isAuthed()) logoutFlow();
      else loginFlow();
    });
  }

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

    const header = ["Thời gian đo", "Ngày đo", "Độ mặn (‰)", "pH", "Nhiệt độ (°C)", "Pin (%)"];
    const csvRows = [header];

    rows.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
        String(td.textContent || "").trim().replaceAll('"', '""')
      );
      // wrap with quotes
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

    bindAdminBtn();
    bindExportBtn();
    updateAdminUi();
  });

  // expose (optional)
  window.AdminAuth = { isAuthed };
})();
