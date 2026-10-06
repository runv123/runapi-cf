const state = {
  baseUrl: "",
  adminToken: "",
  keys: [],
  models: [],
  currentPage: "dashboard"
};

const $ = (id) => document.getElementById(id);

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setConnection(connected) {
  $("connectionText").textContent = connected ? "已连接" : "未连接";
  document.querySelector(".dot").style.background = connected ? "#16a34a" : "#9ca3af";
}

function saveSession() {
  sessionStorage.setItem("runapi_base_url", state.baseUrl);
  sessionStorage.setItem("runapi_admin_token", state.adminToken);
}

function loadSession() {
  state.baseUrl = normalizeBaseUrl(sessionStorage.getItem("runapi_base_url") || localStorage.getItem("runapi_base_url") || "");
  state.adminToken = sessionStorage.getItem("runapi_admin_token") || "";
}

async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  if (state.adminToken) {
    headers.Authorization = `Bearer ${state.adminToken}`;
  }

  const response = await fetch(`${state.baseUrl}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message =
      typeof data === "object"
        ? data?.error?.message || "请求失败"
        : data || "请求失败";
    throw new Error(message);
  }

  return data;
}

function showPage(pageName) {
  state.currentPage = pageName;

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageName);
  });

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `${pageName}Page`);
  });

  const titles = {
    dashboard: "概览",
    keys: "API Keys",
    models: "模型",
    playground: "API 测试",
    settings: "设置"
  };

  $("pageTitle").textContent = titles[pageName] || "RunAPI";

  if (pageName === "keys") loadKeys();
  if (pageName === "models") loadModels();
}

async function login() {
  const baseUrl = normalizeBaseUrl($("apiBaseInput").value);
  const token = $("adminTokenInput").value.trim();

  if (!baseUrl) {
    $("loginMessage").textContent = "请输入 Cloudflare Worker 地址。";
    return;
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    $("loginMessage").textContent = "Worker 地址必须以 http:// 或 https:// 开头。";
    return;
  }

  if (!token) {
    $("loginMessage").textContent = "请输入 ADMIN_TOKEN。";
    return;
  }

  state.baseUrl = baseUrl;
  state.adminToken = token;

  $("loginMessage").textContent = "正在连接...";

  try {
    await loadKeys();
    await loadModels();

    saveSession();

    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");

    setConnection(true);
    updateDashboard();

    $("loginMessage").textContent = "";
    showToast("RunAPI 连接成功");
  } catch (error) {
    state.adminToken = "";
    setConnection(false);
    $("loginMessage").textContent = `连接失败：${error.message}`;
  }
}

function logout() {
  state.adminToken = "";
  sessionStorage.removeItem("runapi_admin_token");
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("logoutBtn").classList.add("hidden");
  $("adminTokenInput").value = "";
  setConnection(false);
  showToast("已退出");
}

async function loadKeys() {
  const data = await apiFetch("/admin/keys");
  state.keys = Array.isArray(data.data) ? data.data : [];
  renderKeys();
  updateDashboard();
  return state.keys;
}

function renderKeys() {
  const container = $("keysList");

  $("keysSummary").textContent =
    `共 ${state.keys.length} 个 Key`;

  if (!state.keys.length) {
    container.innerHTML = `
      <div class="key-row">
        <span class="hint">还没有 API Key。创建一个吧。</span>
      </div>`;
    return;
  }

  container.innerHTML = state.keys.map((key) => {
    const paused = key.status === "paused";
    const statusClass = paused ? "paused" : "active";
    const statusText = paused ? "已暂停" : "正常";

    return `
      <div class="key-row">
        <div class="key-main">
          <div>
            <div class="key-name">${escapeHtml(key.name || "未命名 Key")}</div>
            <div class="key-meta">
              前缀：${escapeHtml(key.prefix || "-")}<br>
              请求次数：${Number(key.requestCount || 0)}<br>
              创建时间：${escapeHtml(key.createdAt || "-")}<br>
              最后使用：${escapeHtml(key.lastUsedAt || "尚未使用")}
            </div>
          </div>
          <span class="status ${statusClass}">${statusText}</span>
        </div>

        <div class="key-actions">
          <button class="button secondary" data-action="toggle" data-id="${escapeHtml(key.id)}" data-status="${escapeHtml(key.status)}">
            ${paused ? "恢复" : "暂停"}
          </button>
          <button class="button secondary" data-action="regenerate" data-id="${escapeHtml(key.id)}">
            重新生成
          </button>
          <button class="button danger" data-action="delete" data-id="${escapeHtml(key.id)}">
            删除
          </button>
        </div>
      </div>`;
  }).join("");
}

async function createKey() {
  const name = $("keyName").value.trim();
  const prefix = $("keyPrefix").value.trim();

  if (!name) {
    showToast("请填写 Key 名称");
    return;
  }

  if (!prefix || !/^[A-Za-z0-9_-]+$/.test(prefix)) {
    showToast("前缀只能包含字母、数字、_ 和 -");
    return;
  }

  try {
    const data = await apiFetch("/admin/keys", {
      method: "POST",
      body: JSON.stringify({ name, prefix })
    });

    $("newKeyCard").classList.remove("hidden");
    $("newKeyValue").textContent = data.key || "";
    await loadKeys();
    showToast("API Key 创建成功");
  } catch (error) {
    showToast(`创建失败：${error.message}`);
  }
}

async function toggleKey(id, status) {
  const action = status === "paused" ? "resume" : "pause";

  try {
    await apiFetch(`/admin/keys/${encodeURIComponent(id)}/${action}`, {
      method: "POST"
    });
    await loadKeys();
    showToast(action === "pause" ? "Key 已暂停" : "Key 已恢复");
  } catch (error) {
    showToast(`操作失败：${error.message}`);
  }
}

async function regenerateKey(id) {
  if (!confirm("重新生成后，旧 Key 会立即失效。确定继续吗？")) {
    return;
  }

  try {
    const data = await apiFetch(`/admin/keys/${encodeURIComponent(id)}/regenerate`, {
      method: "POST"
    });

    $("newKeyCard").classList.remove("hidden");
    $("newKeyValue").textContent = data.key || "";
    await loadKeys();
    showToast("Key 已重新生成");
  } catch (error) {
    showToast(`重新生成失败：${error.message}`);
  }
}

async function deleteKey(id) {
  if (!confirm("确定删除这个 API Key 吗？删除后无法恢复。")) {
    return;
  }

  try {
    await apiFetch(`/admin/keys/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    await loadKeys();
    showToast("Key 已删除");
  } catch (error) {
    showToast(`删除失败：${error.message}`);
  }
}

async function loadModels() {
  const data = await apiFetch("/v1/models");
  state.models = Array.isArray(data.data) ? data.data : [];
  renderModels();
  updateModelSelect();
  updateDashboard();
  return state.models;
}

function renderModels() {
  const container = $("modelsList");

  if (!state.models.length) {
    container.innerHTML = `<div class="card"><p>没有读取到模型。</p></div>`;
    return;
  }

  container.innerHTML = state.models.map((model) => `
    <div class="model-card">
      <h3>${escapeHtml(model.name || model.id)}</h3>
      <p>${escapeHtml(model.description || "暂无描述")}</p>
      <div class="model-id">${escapeHtml(model.id)}</div>
      <p class="hint">提供方：${escapeHtml(model.owned_by || "-")}</p>
    </div>
  `).join("");
}

function updateModelSelect() {
  const select = $("testModel");
  const current = select.value;

  select.innerHTML = state.models.map((model) => `
    <option value="${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)}</option>
  `).join("");

  if (state.models.some((model) => model.id === current)) {
    select.value = current;
  }
}

function updateDashboard() {
  const active = state.keys.filter((key) => key.status === "active").length;
  const requests = state.keys.reduce((sum, key) => sum + Number(key.requestCount || 0), 0);

  $("statKeys").textContent = state.keys.length;
  $("statActiveKeys").textContent = active;
  $("statModels").textContent = state.models.length;
  $("statRequests").textContent = requests;

  $("baseUrlDisplay").textContent = state.baseUrl || "-";
  $("quickStartCode").textContent =
`Base URL: ${state.baseUrl || "-"}
API Key: 你的 RunAPI Key
Model: ${state.models[0]?.id || "@cf/zai-org/glm-4.7-flash"}`;
}

async function sendTest() {
  const key = $("testKey").value.trim();
  const model = $("testModel").value;
  const message = $("testMessage").value.trim();
  const stream = $("testStream").checked;

  if (!key) {
    $("testStatus").textContent = "请输入 API Key。";
    return;
  }

  if (!model) {
    $("testStatus").textContent = "请选择模型。";
    return;
  }

  if (!message) {
    $("testStatus").textContent = "请输入消息。";
    return;
  }

  $("testStatus").textContent = "正在请求...";
  $("testOutput").textContent = "";

  try {
    const response = await fetch(`${state.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: message
          }
        ],
        stream
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    if (stream) {
      await readStream(response);
    } else {
      const data = await response.json();
      $("testOutput").textContent = JSON.stringify(data, null, 2);
    }

    $("testStatus").textContent = "请求完成";
  } catch (error) {
    $("testStatus").textContent = `请求失败：${error.message}`;
  }
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const data = JSON.parse(payload);
        const text =
          data?.choices?.[0]?.delta?.content ??
          data?.choices?.[0]?.message?.content ??
          "";

        if (text) {
          $("testOutput").textContent += text;
        }
      } catch {
        $("testOutput").textContent += payload;
      }
    }
  }
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  showToast("已复制");
}

function saveSettings() {
  const value = normalizeBaseUrl($("settingsBaseUrl").value);

  if (!value || !/^https?:\/\//i.test(value)) {
    $("settingsMessage").textContent = "请输入有效的 Worker 地址。";
    return;
  }

  state.baseUrl = value;
  localStorage.setItem("runapi_base_url", value);
  sessionStorage.setItem("runapi_base_url", value);
  updateDashboard();

  $("settingsMessage").textContent = "地址已保存。";
  showToast("已保存");
}

document.addEventListener("DOMContentLoaded", () => {
  loadSession();

  if (state.baseUrl) {
    $("apiBaseInput").value = state.baseUrl;
    $("settingsBaseUrl").value = state.baseUrl;
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.go));
  });

  $("loginBtn").addEventListener("click", login);
  $("logoutBtn").addEventListener("click", logout);

  $("refreshKeysBtn").addEventListener("click", async () => {
    try {
      await loadKeys();
      showToast("Keys 已刷新");
    } catch (error) {
      showToast(`刷新失败：${error.message}`);
    }
  });

  $("createKeyBtn").addEventListener("click", createKey);

  $("copyNewKeyBtn").addEventListener("click", () => {
    copyText($("newKeyValue").textContent);
  });

  $("refreshModelsBtn").addEventListener("click", async () => {
    try {
      await loadModels();
      showToast("模型已刷新");
    } catch (error) {
      showToast(`刷新失败：${error.message}`);
    }
  });

  $("sendTestBtn").addEventListener("click", sendTest);

  $("copyBaseBtn").addEventListener("click", () => {
    if (state.baseUrl) copyText(state.baseUrl);
  });

  $("saveSettingsBtn").addEventListener("click", saveSettings);

  $("keysList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "toggle") {
      await toggleKey(id, button.dataset.status);
    } else if (action === "regenerate") {
      await regenerateKey(id);
    } else if (action === "delete") {
      await deleteKey(id);
    }
  });

  setConnection(false);
});
