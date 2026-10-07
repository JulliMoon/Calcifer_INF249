/* =====================================================
   AURA – shared script for every page
   One data store (localStorage) so all pages stay
   connected: Dashboard, Projects, Asset Registry,
   Audit Log, Integration Gateway and Settings.
   Every render function checks that its elements exist,
   so it is safe to load this file on any page.
===================================================== */

/* ---------- small helpers ---------- */

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));

const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

function load(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v ?? clone(fallback);
    } catch (e) {
        return clone(fallback);
    }
}

function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

const fmtDay = d =>
    new Date(d).toLocaleDateString("en-US",
        { month: "short", day: "numeric", year: "numeric" });

const fmtDateTime = d =>
    new Date(d).toLocaleString("en-US",
        { month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit" });

function timeAgo(ts) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000));
    if (mins < 60) return mins + "m";
    if (mins < 1440) return Math.round(mins / 60) + "h";
    return Math.round(mins / 1440) + "d";
}


/* ---------- default (starter) data ---------- */

const KEYS = {
    assets: "aura_assets",
    logs: "aura_logs",
    projects: "aura_projects",
    accounts: "aura_accounts",
    integration: "aura_integration",
    settings: "aura_settings"
};

const DEFAULT_PROJECTS = [];

const DEFAULT_ASSETS = [];

const DEFAULT_LOGS = [];

const DEFAULT_INTEGRATION = {
    enabled: true,
    endpoint: "https://api.aura-gamehub.com/webhook",
    storage: "AWS S3",
    events: {
        "Asset Approved": true,
        "Asset Synchronized": true,
        "Revision Requested": true,
        "Version Uploaded": true
    },
    lastTrigger: "—",
    lastResult: "No activity yet"
};

const DEFAULT_SETTINGS = {
    profile: { name: "Administrator", email: "admin@aura.com" },
    maxUpload: 500,
    approvalNotif: true,
    sessionTimeout: 30,
    notificationsRead: false
};


/* =========================
   AUTH
   Two demo accounts: an Artist who uploads/submits assets, and an
   Admin who approves or requests revisions. Not real security —
   just enough to gate the UI and tag audit log entries correctly.
========================= */

const DEFAULT_ACCOUNTS = [
    { username: "artist", password: "artist123", role: "Artist", name: "Maria Santos" },
    { username: "admin",  password: "admin123",  role: "Admin",  name: "Alex Cruz" }
];

const getAccounts = () => load(KEYS.accounts, DEFAULT_ACCOUNTS);

const SESSION_KEY = "aura_session";

function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch (e) { return null; }
}

function isAdmin() {
    const session = getSession();
    return !!session && session.role === "Admin";
}

function fillLogin(username, password) {
    $("loginUsername").value = username;
    $("loginPassword").value = password;
}

function login() {
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    const errorEl = $("loginError");

    const account = getAccounts().find(a =>
        a.username.toLowerCase() === username.toLowerCase() && a.password === password);

    if (!account) {
        if (errorEl) errorEl.textContent = "Incorrect username or password.";
        return;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify({
        username: account.username, role: account.role, name: account.name
    }));

    location.href = "dashboard.html";
}

function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.href = "login.html";
}

const CURRENT_PAGE = (location.pathname.split("/").pop() || "dashboard.html");
const SESSION = getSession();

if (CURRENT_PAGE === "login.html") {
    // already signed in — no reason to see the login form again
    if (SESSION) location.href = "dashboard.html";
} else if (!SESSION) {
    location.href = "login.html";
}

const IS_LOGGED_IN_PAGE = CURRENT_PAGE !== "login.html" && !!SESSION;

function applyRolePermissions() {
    const admin = isAdmin();

    // Register Asset is an Artist-only action; Admin only reviews
    document.querySelectorAll(".artist-only").forEach(el => {
        el.style.display = admin ? "none" : "";
    });

    // The account list (Users & Roles) is Admin-only
    document.querySelectorAll(".admin-only").forEach(el => {
        el.style.display = admin ? "" : "none";
    });
}


/* ---------- data access ---------- */

const getAssets   = () => load(KEYS.assets, DEFAULT_ASSETS);
const getLogs     = () => load(KEYS.logs, DEFAULT_LOGS);
const getProjects = () => load(KEYS.projects, DEFAULT_PROJECTS);

function getIntegration() {
    const s = load(KEYS.integration, DEFAULT_INTEGRATION);
    s.events = { ...DEFAULT_INTEGRATION.events, ...(s.events || {}) };
    return { ...DEFAULT_INTEGRATION, ...s };
}

function getSettings() {
    const s = load(KEYS.settings, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...s, profile: { ...DEFAULT_SETTINGS.profile, ...(s.profile || {}) } };
}


/* ---------- audit log + webhook ---------- */

function logAction(action, asset, result = "Success") {
    const logs = getLogs();
    const session = getSession();

    logs.unshift({
        ts: new Date().toISOString(),
        user: session ? session.name : getSettings().profile.name,
        action: action,
        project: asset ? asset.project : "-",
        asset: asset ? asset.name : "-",
        version: asset ? asset.version : "-",
        result: result
    });

    save(KEYS.logs, logs.slice(0, 200));

    // new activity = new notifications
    const s = getSettings();
    s.notificationsRead = false;
    save(KEYS.settings, s);
}

/*
    Simulated webhook. Only fires when the integration is ON and
    that event is ticked in the Integration Gateway.
    Later, replace the console.log with a real fetch() to your
    Django/DRF endpoint.
*/
function fireWebhook(eventName, asset) {
    const integ = getIntegration();

    if (!integ.enabled || !integ.events[eventName]) return false;

    console.log("Webhook →", integ.endpoint, { event: eventName, asset: asset ? asset.name : null });

    integ.lastTrigger = fmtDateTime(new Date());
    integ.lastResult = "✓ " + eventName + " sent";
    save(KEYS.integration, integ);

    return true;
}


/* =========================
   MODALS (shared)
========================= */

function openRegisterModal() {
    populateSelects();
    $("registerModal").classList.add("show");
}

function closeRegisterModal() {
    $("registerModal").classList.remove("show");
}

function openProjectModal() {
    $("projectModal").classList.add("show");
}

function closeProjectModal() {
    $("projectModal").classList.remove("show");
}

// click on the dark background closes any modal
document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => {
        if (e.target === modal) modal.classList.remove("show");
    });
});


/* fill the Project dropdown and the read-only Artist field */
function populateSelects() {
    const projectSel = $("assetProject");
    const artistDisplay = $("assetArtistDisplay");

    if (projectSel) {
        const projects = getProjects();

        projectSel.innerHTML = projects.length
            ? projects.map(p => `<option>${esc(p.name)}</option>`).join("")
            : `<option value="">No projects yet — create one first</option>`;
    }

    if (artistDisplay) {
        const session = getSession();
        artistDisplay.textContent = session ? session.name : "-";
    }
}


/* =========================
   ASSETS
========================= */

function registerAsset() {

    const name = $("assetName").value.trim();
    const type = $("assetType").value;
    const project = $("assetProject").value;
    const artist = (getSession() || {}).name || "Unknown";
    const fileInput = $("assetFile");
    const file = fileInput ? fileInput.files[0] : null;

    if (name === "") return alert("Please enter an asset name.");
    if (type === "Select type") return alert("Please select an asset type.");
    if (!project) return alert("Please create a project first.");
    if (!file) return alert("Please select a file.");

    const maxMB = Number(getSettings().maxUpload) || 500;
    if (file.size > maxMB * 1024 * 1024) {
        return alert("File is too big. Max upload size is " + maxMB + " MB (see Settings).");
    }

    const assets = getAssets();

    // same name in the same project = new version of that asset
    let asset = assets.find(a =>
        a.name.toLowerCase() === name.toLowerCase() && a.project === project);

    if (asset) {
        asset.version = "v" + (parseInt(asset.version.slice(1)) + 1);
        asset.type = type;
        asset.artist = artist;
        asset.status = "In Progress";
        asset.integration = "Not Ready";
        asset.date = fmtDay(new Date());
    } else {
        const nextNum = assets.reduce((m, a) =>
            Math.max(m, parseInt(a.id.replace("AST-", "")) || 0), 0) + 1;

        asset = {
            id: "AST-" + String(nextNum).padStart(3, "0"),
            name: name,
            type: type,
            project: project,
            artist: artist,
            version: "v1",
            status: "In Progress",
            integration: "Not Ready",
            date: fmtDay(new Date())
        };
        assets.push(asset);
    }

    save(KEYS.assets, assets);
    logAction("Uploaded", asset);
    fireWebhook("Version Uploaded", asset);

    closeRegisterModal();

    $("assetName").value = "";
    $("assetType").value = "Select type";
    fileInput.value = "";

    renderAll();
}

function changeStatus(id, status, action, webhookEvent) {
    const assets = getAssets();
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    asset.status = status;
    asset.integration = status === "Approved" ? "Ready" : "Not Ready";

    save(KEYS.assets, assets);
    logAction(action, asset);
    if (webhookEvent) fireWebhook(webhookEvent, asset);

    renderAll();
}

function submitForReview(id) { changeStatus(id, "Under Review", "Submitted"); }

function approveAsset(id) { changeStatus(id, "Approved", "Approved", "Asset Approved"); }

function requestRevision(id) { changeStatus(id, "Revision Required", "Revision Required", "Revision Requested"); }

function deleteAsset(id) {
    if (!isAdmin()) return;

    const assets = getAssets();
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    if (!confirm(`Delete "${asset.name} ${asset.version}"? This cannot be undone.`)) return;

    save(KEYS.assets, assets.filter(a => a.id !== id));
    logAction("Asset Deleted", asset);

    renderAll();
}

function assetActions(a) {
    const admin = isAdmin();

    // Admin: reviews assets, and can delete any of them
    if (admin) {
        const review = a.status === "Under Review"
            ? `<button class="action-btn" onclick="approveAsset('${a.id}')">Approve</button>
               <button class="action-btn danger" onclick="requestRevision('${a.id}')">Revise</button>`
            : "";

        return `${review}
                <button class="action-btn danger" onclick="deleteAsset('${a.id}')">Delete</button>`;
    }

    // Artist: uploads and submits their own work for review
    if (a.status === "In Progress" || a.status === "Revision Required") {
        return `<button class="action-btn" onclick="submitForReview('${a.id}')">Submit</button>`;
    }
    return "—";
}

function renderAssets() {

    const tbody = $("assetTableBody");
    if (!tbody) return;

    const search = $("searchAsset").value.toLowerCase();
    const status = $("filterStatus").value;
    const projectParam = new URLSearchParams(location.search).get("project");

    const subtitle = $("registrySubtitle");
    if (subtitle) {
        subtitle.innerHTML = projectParam
            ? `Showing assets for <b>${esc(projectParam)}</b> · <a href="asset-registry.html">Show all</a>`
            : "Manage all uploaded game assets.";
    }

    const badges = {
        "Approved": "approved",
        "Under Review": "review",
        "Revision Required": "revision"
    };

    tbody.innerHTML = getAssets()
        .filter(a =>
            a.name.toLowerCase().includes(search) &&
            (!status || a.status === status) &&
            (!projectParam || a.project === projectParam))
        .map(a => `
<tr class="asset-row">
<td>${esc(a.name)}</td>
<td>${esc(a.type)}</td>
<td>${esc(a.project)}</td>
<td>${esc(a.artist)}</td>
<td>${esc(a.version)}</td>
<td><span class="status-pill ${badges[a.status] || "progress-status"}">${esc(a.status)}</span></td>
<td>${esc(a.integration)}</td>
<td>${esc(a.date)}</td>
<td>${assetActions(a)}</td>
</tr>`)
        .join("") || `<tr><td colspan="9" style="padding:20px;text-align:center">No assets found.</td></tr>`;
}


/* =========================
   AUDIT LOG
========================= */

function renderAuditLogs() {

    const tbody = $("auditTableBody");
    if (!tbody) return;

    const search = $("searchAudit").value.toLowerCase();
    const action = $("actionFilter").value;

    tbody.innerHTML = getLogs()
        .filter(l =>
            (!action || l.action === action) &&
            [l.user, l.action, l.project, l.asset].join(" ").toLowerCase().includes(search))
        .map(l => `
<tr>
<td>${esc(fmtDateTime(l.ts))}</td>
<td>${esc(l.user)}</td>
<td>${esc(l.action)}</td>
<td>${esc(l.project)}</td>
<td>${esc(l.asset)}</td>
<td>${esc(l.version)}</td>
<td>${esc(l.result)}</td>
</tr>`)
        .join("") || `<tr><td colspan="7" style="padding:20px;text-align:center">No logs found.</td></tr>`;
}


/* =========================
   DASHBOARD
========================= */

function describeLog(l) {
    const verbs = {
        "Uploaded": "uploaded",
        "Submitted": "submitted",
        "Approved": "approved",
        "Revision Required": "requested revision for",
        "Synchronized": "synchronized",
        "Webhook Test": "ran a webhook test"
    };

    const asset = l.asset && l.asset !== "-"
        ? ` <strong>${esc(l.asset)} ${esc(l.version)}</strong>` : "";

    return `<b>${esc(l.user)}</b> ${verbs[l.action] || esc(l.action).toLowerCase()}${asset}`;
}

function renderDashboard() {

    if (!$("metricActive")) return;

    const assets = getAssets();
    const logs = getLogs();
    const integ = getIntegration();
    const settings = getSettings();
    const count = fn => assets.filter(fn).length;

    const active   = count(a => a.status === "In Progress" || a.status === "Revision Required");
    const review   = count(a => a.status === "Under Review");
    const approved = count(a => a.status === "Approved");
    const ready    = count(a => a.integration === "Ready");

    $("metricActive").textContent = active;
    $("metricReview").textContent = review;
    $("metricReady").textContent = ready;

    $("pipeActive").textContent = active;
    $("pipeReview").textContent = review;
    $("pipeApproved").textContent = approved;
    $("pipeReady").textContent = ready;

    // integration status
    const gw = $("metricGateway");
    gw.textContent = integ.enabled ? "ONLINE" : "OFFLINE";
    gw.className = integ.enabled ? "online" : "offline";
    $("metricGatewayText").textContent =
        integ.enabled ? "Webhook service is responding" : "Integration is disabled";

    // active project card — feature the first project that isn't
    // already Completed, falling back to the first project overall
    const projects = getProjects();
    const project = projects.find(p => computeProjectStatus(p.name, assets) !== "Completed") || projects[0];

    if (project) {
        const list = assets.filter(a => a.project === project.name);
        const done = list.filter(a => a.status === "Approved").length;
        const percent = list.length ? Math.round(done / list.length * 100) : 0;
        const current = list[list.length - 1];

        $("activeProjectName").textContent = project.name;
        $("activeProjectDesc").textContent = project.description;
        $("activeProjectManager").textContent = project.manager;
        $("activeProjectArtist").textContent = current ? current.artist : "-";
        $("activeProjectAsset").textContent = current ? current.name + " " + current.version : "-";
        $("projectProgressText").textContent = percent + "%";
        $("projectProgressFill").style.width = percent + "%";
    } else {
        $("activeProjectName").textContent = "No projects yet";
        $("activeProjectDesc").textContent = "Create a project to get started.";
        $("activeProjectManager").textContent = "—";
        $("activeProjectArtist").textContent = "—";
        $("activeProjectAsset").textContent = "—";
        $("projectProgressText").textContent = "0%";
        $("projectProgressFill").style.width = "0%";
    }

    // recent activity (latest 3 audit log entries)
    $("activityList").innerHTML = logs.slice(0, 3).map(l => {
        const time = new Date(l.ts)
            .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            .replace(" ", "<br>");

        return `<div class="activity"><span>${time}</span><p>${describeLog(l)}</p></div>`;
    }).join("") || "<p>No activity yet.</p>";

    // notifications
    const notes = [];
    const lastOf = action => logs.find(l => l.action === action);

    if (settings.approvalNotif) {
        if (review > 0) {
            notes.push(["!", review + (review === 1 ? " asset needs" : " assets need") + " review",
                "Manager approval is required.", "now"]);
        }

        const lastApproved = lastOf("Approved");
        if (lastApproved) {
            notes.push(["✓", lastApproved.asset + " was approved",
                "It is now ready for integration.", timeAgo(lastApproved.ts)]);
        }
    }

    const lastSync = lastOf("Synchronized");
    if (lastSync) {
        notes.push(["↻", "Webhook synchronized",
            lastSync.project + " asset sync completed.", timeAgo(lastSync.ts)]);
    }

    const showNotes = notes.length > 0 && !settings.notificationsRead;

    $("notificationList").innerHTML = showNotes
        ? notes.map(n => `
<div class="notification-item">
    <div class="notification-icon">${n[0]}</div>
    <div><b>${esc(n[1])}</b><p>${esc(n[2])}</p></div>
    <small>${n[3]}</small>
</div>`).join("")
        : "<p>No new notifications.</p>";

    document.querySelectorAll(".notification span").forEach(dot => {
        dot.style.display = showNotes ? "" : "none";
    });
}

function markRead() {
    const s = getSettings();
    s.notificationsRead = true;
    save(KEYS.settings, s);
    renderDashboard();
}


/* =========================
   PROJECTS
========================= */

/*
    A project's status is never stored — it's detected automatically
    from the state of its assets, every time it's rendered:
      - "For Revision" — at least one asset was sent back for changes
      - "Completed"    — it has assets and every one is Approved
      - "Pending"       — anything else (in progress, under review,
                          or no assets registered yet)
    Revision takes priority even if other assets are already approved,
    since that's the one that needs attention.
*/
function computeProjectStatus(projectName, assets) {
    const mine = assets.filter(a => a.project === projectName);

    if (!mine.length) return "Pending";
    if (mine.some(a => a.status === "Revision Required")) return "For Revision";
    if (mine.every(a => a.status === "Approved")) return "Completed";
    return "Pending";
}

const STATUS_BADGE_CLASS = {
    "Completed": "completed",
    "For Revision": "for-revision",
    "Pending": "pending"
};

function renderProjects() {

    const grid = $("projectsGrid");
    if (!grid) return;

    const search = $("projectSearch").value.toLowerCase();
    const statusFilter = $("projectStatusFilter").value;
    const sort = $("projectSort").value;
    const assets = getAssets();
    const logs = getLogs();

    let list = getProjects().map((p, i) => {
        const mine = assets.filter(a => a.project === p.name);
        const approved = mine.filter(a => a.status === "Approved").length;
        const lastLog = logs.find(l => l.project === p.name);

        return {
            ...p,
            order: i,
            status: computeProjectStatus(p.name, assets),
            total: mine.length,
            pending: mine.filter(a => a.status === "Under Review").length,
            approved: approved,
            ready: mine.filter(a => a.integration === "Ready" || a.integration === "Synchronized").length,
            percent: mine.length ? Math.round(approved / mine.length * 100) : 0,
            updated: lastLog ? fmtDay(lastLog.ts) : p.created
        };
    }).filter(p =>
        p.name.toLowerCase().includes(search) && (!statusFilter || p.status === statusFilter));

    if (sort === "Name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "Date Created") list.sort((a, b) => b.order - a.order);
    if (sort === "Progress") list.sort((a, b) => b.percent - a.percent);

    grid.innerHTML = list.map(p => `
<div class="project-list-card">
    <div class="project-thumb">🎮</div>
    <h2>${esc(p.name)}</h2>
    <p>${esc(p.description)}</p>
    <div class="status-badge ${STATUS_BADGE_CLASS[p.status]}">${esc(p.status)}</div>
    <div class="project-stats">
        <span>Manager: ${esc(p.manager)}</span>
        <span>Assets: ${p.total}</span>
        <span>Pending Reviews: ${p.pending}</span>
        <span>Approved: ${p.approved}</span>
        <span>Ready: ${p.ready}</span>
    </div>
    <div class="progress-bar">
        <div class="progress-fill" style="width:${p.percent}%"></div>
    </div>
    <div class="dates">
        <small>Created: ${esc(p.created)}</small>
        <small>Updated: ${esc(p.updated)}</small>
    </div>
    <button class="view-project" data-project="${esc(p.name)}"
        onclick="openProject(this.dataset.project)">
        Open Project
    </button>
    <button class="delete-project-btn admin-only" data-project="${esc(p.name)}"
        onclick="deleteProject(this.dataset.project)">
        Delete Project
    </button>
</div>`).join("") || "<p>No projects found.</p>";
}

function openProject(name) {
    location.href = "asset-registry.html?project=" + encodeURIComponent(name);
}

function createProject() {

    const name = $("projectName").value.trim();
    const description = $("projectDesc").value.trim();
    const manager = $("projectManager").value.trim();

    if (name === "") return alert("Please enter a project name.");

    const projects = getProjects();

    if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return alert("A project with that name already exists.");
    }

    projects.push({
        id: "PRJ-" + String(projects.length + 1).padStart(3, "0"),
        name: name,
        description: description || "No description yet.",
        manager: manager || "Unassigned",
        created: fmtDay(new Date())
    });

    save(KEYS.projects, projects);

    $("projectName").value = "";
    $("projectDesc").value = "";
    $("projectManager").value = "";

    closeProjectModal();
    renderProjects();
}

function deleteProject(name) {
    if (!isAdmin()) return;

    const removedCount = getAssets().filter(a => a.project === name).length;
    const warning = removedCount
        ? `Delete project "${name}"? This will also delete its ${removedCount} registered asset(s). This cannot be undone.`
        : `Delete project "${name}"? This cannot be undone.`;

    if (!confirm(warning)) return;

    save(KEYS.projects, getProjects().filter(p => p.name !== name));
    save(KEYS.assets, getAssets().filter(a => a.project !== name));

    logAction("Project Deleted", { project: name, name: removedCount + " asset(s) removed", version: "-" });

    renderAll();
}


/* =========================
   INTEGRATION GATEWAY
========================= */

function renderGateway() {

    if (!$("gatewayStatus")) return;

    const integ = getIntegration();

    $("gatewayStatus").innerHTML = integ.enabled ? "🟢 ONLINE" : "🔴 OFFLINE";

    const btn = document.querySelector(".disable-btn");
    if (btn) btn.textContent = integ.enabled ? "Disable Integration" : "Enable Integration";

    $("webhookEndpoint").value = integ.endpoint;
    $("storageType").value = integ.storage;

    document.querySelectorAll("[data-event]").forEach(box => {
        box.checked = !!integ.events[box.dataset.event];
    });

    $("lastTrigger").textContent = integ.lastTrigger;
    $("lastResult").textContent = integ.lastResult;
}

function saveGatewayConfig() {
    const integ = getIntegration();

    integ.endpoint = $("webhookEndpoint").value.trim() || DEFAULT_INTEGRATION.endpoint;
    integ.storage = $("storageType").value;

    document.querySelectorAll("[data-event]").forEach(box => {
        integ.events[box.dataset.event] = box.checked;
    });

    save(KEYS.integration, integ);
}

function toggleIntegration() {
    const integ = getIntegration();
    integ.enabled = !integ.enabled;
    save(KEYS.integration, integ);
    renderGateway();
}

function testWebhook() {
    const integ = getIntegration();

    if (!integ.enabled) return alert("Integration is disabled. Enable it first.");

    integ.lastTrigger = fmtDateTime(new Date());
    integ.lastResult = "✓ Webhook test successful";
    save(KEYS.integration, integ);

    logAction("Webhook Test", null);
    renderGateway();

    alert("Webhook Test Successful");
}

function syncAssets() {
    const integ = getIntegration();

    if (!integ.enabled) return alert("Integration is disabled. Enable it first.");

    const assets = getAssets();
    const ready = assets.filter(a => a.integration === "Ready");

    if (ready.length === 0) return alert("No assets are ready to sync.");

    ready.forEach(a => {
        a.integration = "Synchronized";
        logAction("Synchronized", a);
        fireWebhook("Asset Synchronized", a);
    });

    save(KEYS.assets, assets);

    const fresh = getIntegration();          // fireWebhook may have updated it
    fresh.lastTrigger = fmtDateTime(new Date());
    fresh.lastResult = "✓ " + ready.length + " asset(s) synchronized";
    save(KEYS.integration, fresh);

    renderGateway();
    alert(ready.length + " asset(s) synchronized.");
}


/* =========================
   SETTINGS
========================= */

function showTab(tabId, btn) {
    // the account list is admin-only, even if someone calls this directly
    if (tabId === "users" && !isAdmin()) return;

    document.querySelectorAll(".settings-tab")
        .forEach(t => t.classList.add("hidden"));

    document.querySelectorAll(".settings-menu-btn")
        .forEach(b => b.classList.remove("active-tab"));

    $(tabId).classList.remove("hidden");
    if (btn) btn.classList.add("active-tab");
}

function loadSettingsForm() {

    if (!$("sessionTimeout")) return;

    const s = getSettings();

    $("name").value = s.profile.name;
    $("email").value = s.profile.email;
    $("maxUpload").value = s.maxUpload;
    $("webhook").value = getIntegration().endpoint;
    $("approvalNotif").checked = s.approvalNotif;
    $("sessionTimeout").value = s.sessionTimeout;

    const first = document.querySelector(".settings-menu-btn:not(.admin-only)");
    if (first) first.classList.add("active-tab");

    renderAccounts();
}

function saveProfile() {
    const name = $("name").value.trim();
    const email = $("email").value.trim();

    if (name === "" || !email.includes("@")) {
        return alert("Please enter a name and a valid email.");
    }

    const s = getSettings();
    s.profile = { name, email };
    save(KEYS.settings, s);

    applyProfile();
    alert("Profile Saved");
}


/* =========================
   ACCOUNTS (Admin only)
   Lets the Admin hand out real login accounts — name, username,
   password, role — to new hires. Visible only when signed in
   as Admin; gated in both the HTML (.admin-only) and here.
========================= */

function renderAccounts() {
    const list = $("accountsList");
    if (!list || !isAdmin()) return;

    const session = getSession();

    list.innerHTML = getAccounts().map(a => `
<div class="user-card">
    <b>${esc(a.name)}</b> <span class="account-role">${esc(a.role)}</span>
    <br>
    <small>Username: <code>${esc(a.username)}</code> &nbsp; Password: <code>${esc(a.password)}</code></small>
    ${session && session.username === a.username
        ? `<br><small class="you-label">This is you</small>`
        : `<button class="action-btn danger account-delete-btn" data-username="${esc(a.username)}"
               onclick="deleteAccount(this.dataset.username)">Delete</button>`}
</div>`).join("");
}

function deleteAccount(username) {
    if (!isAdmin()) return;

    const session = getSession();
    if (session && session.username === username) {
        return alert("You can't delete the account you're currently logged in as.");
    }

    const accounts = getAccounts();
    const target = accounts.find(a => a.username === username);
    if (!target) return;

    const adminCount = accounts.filter(a => a.role === "Admin").length;
    if (target.role === "Admin" && adminCount <= 1) {
        return alert("You can't delete the last Admin account.");
    }

    if (!confirm(`Delete the account "${target.name}" (${target.username})? This cannot be undone.`)) return;

    save(KEYS.accounts, accounts.filter(a => a.username !== username));
    renderAccounts();
}

function addAccount() {
    if (!isAdmin()) return;

    const name = $("newAccountName").value.trim();
    const username = $("newAccountUsername").value.trim();
    const password = $("newAccountPassword").value;
    const role = $("newAccountRole").value;

    if (name === "" || username === "" || password === "") {
        return alert("Please fill in name, username, and password.");
    }

    const accounts = getAccounts();

    if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
        return alert("That username is already taken.");
    }

    accounts.push({ name, username, password, role });
    save(KEYS.accounts, accounts);

    $("newAccountName").value = "";
    $("newAccountUsername").value = "";
    $("newAccountPassword").value = "";

    renderAccounts();
    alert(name + "'s account has been created.");
}

function saveAssetSettings() {
    const size = Number($("maxUpload").value);

    if (!(size > 0)) return alert("Enter a valid max upload size.");

    const s = getSettings();
    s.maxUpload = size;
    save(KEYS.settings, s);
    alert("Asset Settings Saved");
}

function saveWebhook() {
    const url = $("webhook").value.trim();

    if (!url.startsWith("http")) return alert("Enter a valid webhook URL.");

    const integ = getIntegration();
    integ.endpoint = url;               // same endpoint the Integration Gateway uses
    save(KEYS.integration, integ);
    alert("Webhook Updated");
}

function saveNotifications() {
    const s = getSettings();
    s.approvalNotif = $("approvalNotif").checked;
    save(KEYS.settings, s);
    alert("Notifications Updated");
}

function saveSecurity() {
    const minutes = Number($("sessionTimeout").value);

    if (!(minutes > 0)) return alert("Enter a valid timeout in minutes.");

    const s = getSettings();
    s.sessionTimeout = minutes;
    save(KEYS.settings, s);
    alert("Security Saved");
}


/* =========================
   PROFILE (topbar) + START
========================= */

function applyProfile() {
    const session = getSession();
    const name = session ? session.name : getSettings().profile.name;

    document.querySelectorAll(".profile").forEach(p => {
        const avatar = p.querySelector(".avatar");
        const label = p.querySelector("span");

        if (avatar) avatar.textContent = name.slice(0, 2).toUpperCase();
        if (label) label.textContent = name;
    });

    const nameEl = $("sidebarUserName");
    const roleEl = $("sidebarUserRole");

    if (session) {
        if (nameEl) nameEl.textContent = session.name;
        if (roleEl) roleEl.textContent = session.role;
    }
}

function renderAll() {
    renderDashboard();
    renderProjects();
    renderAssets();
    renderAuditLogs();
    renderGateway();
}

if (IS_LOGGED_IN_PAGE) {
    applyProfile();
    populateSelects();
    renderAll();
    loadSettingsForm();
    applyRolePermissions();
}


/*
    Keep every open tab/page in sync. localStorage only updates other
    tabs, not the one that made the change, so if you create a project
    on the Projects page while the Dashboard is open in another tab,
    this makes the Dashboard pick it up automatically instead of
    needing a manual refresh.
*/
window.addEventListener("storage", () => {
    if (!IS_LOGGED_IN_PAGE) return;
    applyProfile();
    populateSelects();
    renderAll();
    loadSettingsForm();
    applyRolePermissions();
});
