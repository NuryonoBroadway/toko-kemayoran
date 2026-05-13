const form = document.getElementById("product-form");
const usernameInput = document.getElementById("admin-username");
const passwordInput = document.getElementById("admin-password");
const loginForm = document.getElementById("login-form");
const authMessage = document.getElementById("admin-auth-message");
const formMessage = document.getElementById("form-message");

function getSavedToken() {
  return sessionStorage.getItem("adminToken") || "";
}
const adminProductList = document.getElementById("admin-product-list");
const adminOrderList = document.getElementById("admin-order-list");
const adminCompleteOrderList = document.getElementById("admin-complete-order-list");
const adminDeniedOrderList = document.getElementById("admin-denied-order-list");
const placeholderImage = createPlaceholderImage();
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".admin-tab-panel"));
const productModal = document.getElementById("product-modal");
const openProductModalButton = document.getElementById("open-product-modal");
const closeProductModalButton = document.getElementById("close-product-modal");
const editingProductIdInput = document.getElementById("editing-product-id");
const submitProductButton = document.getElementById("submit-product-button");
const productModalTitle = document.getElementById("product-modal-title");
const variantRows = document.getElementById("variant-rows");
const addVariantRowButton = document.getElementById("add-variant-row");

let isAdminAuthenticated = false;
let orderEventSource = null;

if (loginForm) {
  loginForm.addEventListener("submit", loginAdmin);
}
addVariantRowButton.addEventListener("click", () => addVariantRow());

openProductModalButton.addEventListener("click", () => {
  if (!isAdminAuthenticated) {
    return;
  }
  prepareCreateMode();
  productModal.classList.remove("hidden");
});

closeProductModalButton.addEventListener("click", closeProductModal);

productModal.addEventListener("click", (event) => {
  if (event.target === productModal) {
    closeProductModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !productModal.classList.contains("hidden")) {
    closeProductModal();
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;

    tabButtons.forEach((entry) => {
      entry.classList.toggle("active", entry === button);
    });

    tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== tab);
    });
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminAuthenticated) {
    formMessage.textContent = "Verifikasi token admin terlebih dahulu.";
    return;
  }

  formMessage.textContent = "Menyimpan produk...";
  const formData = new FormData(form);
  const variants = collectVariants();
  const editingProductId = editingProductIdInput.value.trim();
  const isEditing = Boolean(editingProductId);
  const endpoint = isEditing ? `/api/products/${editingProductId}` : "/api/products";
  const method = isEditing ? "PATCH" : "POST";

  if (!variants.length) {
    formMessage.textContent = "Tambahkan minimal satu varian produk.";
    return;
  }

  formData.set("variants", JSON.stringify(variants));

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        "x-admin-token": getSavedToken()
      },
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Gagal menyimpan produk.");
    }

    formMessage.textContent = isEditing ? "Produk berhasil diperbarui." : "Produk berhasil diupload.";
    closeProductModal();
    prepareCreateMode();
    loadProducts();
  } catch (error) {
    formMessage.textContent = error.message;
  }
});

loadProducts();
syncAdminControls();

async function loginAdmin(event) {
  if (event) event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    authMessage.textContent = "Masukkan username dan password.";
    return;
  }

  authMessage.textContent = "Memverifikasi...";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Login gagal.");
    }

    isAdminAuthenticated = true;
    sessionStorage.setItem("adminToken", result.token);
    syncAdminControls();
    authMessage.textContent = "Login berhasil. Sesi aktif.";
    connectOrderStream(result.token);
    loadOrders();
  } catch (error) {
    isAdminAuthenticated = false;
    sessionStorage.removeItem("adminToken");
    disconnectOrderStream();
    syncAdminControls();
    authMessage.textContent = error.message;
  }
}

// Check session on load
const savedToken = getSavedToken();
if (savedToken) {
  isAdminAuthenticated = true;
  syncAdminControls();
  authMessage.textContent = "Sesi aktif.";
  connectOrderStream(savedToken);
  loadOrders();
}

async function loadProducts() {
  adminProductList.innerHTML = "<p>Memuat produk...</p>";

  try {
    const response = await fetch("/api/products");
    const products = (await response.json()).map(normalizeProduct);

    if (!products.length) {
      adminProductList.innerHTML = "<p>Belum ada produk.</p>";
      return;
    }

    adminProductList.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "admin-product-card";
      card.innerHTML = `
        <img class="admin-product-image" src="${product.imageUrl || placeholderImage}" alt="${product.name}" />
        <div class="admin-product-content">
          <div class="admin-product-actions">
            <h4>${product.name}</h4>
            <div class="product-action-group">
              <button class="secondary-button product-edit-button" type="button" ${isAdminAuthenticated ? "" : "disabled"}>Edit</button>
              <button class="danger-button product-delete-button" type="button" ${isAdminAuthenticated ? "" : "disabled"}>Hapus</button>
            </div>
          </div>
          <p class="muted">${product.category} • Total stok ${sumVariantStock(product.variants)}</p>
          <div class="admin-variant-list">
            ${product.variants
              .map(
                (variant) => `
                  <div class="admin-variant-chip">
                    <span>${variant.label}</span>
                    <strong>${formatCurrency(variant.price)}</strong>
                    <span>${variant.stock} stok</span>
                  </div>
                `
              )
              .join("")}
          </div>
          <p class="muted">${product.description || "Tidak ada deskripsi."}</p>
          <strong>${formatCurrency(findLowestVariantPrice(product.variants))}</strong>
        </div>
      `;

      card.querySelector(".product-edit-button").addEventListener("click", () => {
        if (!isAdminAuthenticated) {
          return;
        }
        prepareEditMode(product);
        productModal.classList.remove("hidden");
      });

      card.querySelector(".product-delete-button").addEventListener("click", async () => {
        if (!isAdminAuthenticated) {
          return;
        }

        try {
          const response = await fetch(`/api/products/${product.id}`, {
            method: "DELETE",
            headers: {
              "x-admin-token": getSavedToken()
            }
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.message || "Gagal menghapus produk.");
          }
          loadProducts();
          loadOrders();
        } catch (error) {
          alert(error.message);
        }
      });

      adminProductList.appendChild(card);
    });
  } catch (_error) {
    adminProductList.innerHTML = "<p>Gagal memuat produk.</p>";
  }
}

function prepareCreateMode() {
  form.reset();
  editingProductIdInput.value = "";
  productModalTitle.textContent = "Produk Baru";
  submitProductButton.textContent = "Upload Produk";
  formMessage.textContent = "";
  variantRows.innerHTML = "";
  addVariantRow({ label: "1/4 kg", price: "", stock: "" });
}

function prepareEditMode(product) {
  form.reset();
  editingProductIdInput.value = product.id;
  productModalTitle.textContent = "Edit Produk";
  submitProductButton.textContent = "Simpan Perubahan";
  form.elements.name.value = product.name;
  form.elements.category.value = product.category;
  form.elements.description.value = product.description || "";
  formMessage.textContent = "";
  variantRows.innerHTML = "";
  product.variants.forEach((variant) => addVariantRow(variant));
}

function closeProductModal() {
  productModal.classList.add("hidden");
}

function syncAdminControls() {
  openProductModalButton.disabled = !isAdminAuthenticated;
  submitProductButton.disabled = !isAdminAuthenticated;
  
  const adminSidebar = document.querySelector(".admin-sidebar");
  const adminLayout = document.querySelector(".admin-layout");
  
  if (adminSidebar) {
    adminSidebar.classList.toggle("hidden", isAdminAuthenticated);
  }
  if (adminLayout) {
    adminLayout.classList.toggle("authenticated", isAdminAuthenticated);
  }
  
  loadProducts();
}

function addVariantRow(variant = {}) {
  const row = document.createElement("div");
  row.className = "variant-row";
  row.innerHTML = `
    <input class="variant-id-input" type="hidden" value="${variant.id || ""}" />
    <label>
      Label Varian
      <input class="variant-label-input" type="text" placeholder="1/4 kg" value="${variant.label || ""}" />
    </label>
    <label>
      Harga
      <input class="variant-price-input" type="number" min="1" placeholder="25000" value="${variant.price || ""}" />
    </label>
    <label>
      Stok
      <input class="variant-stock-input" type="number" min="0" placeholder="10" value="${variant.stock ?? ""}" />
    </label>
    <button class="danger-button variant-remove-button" type="button">Hapus</button>
  `;

  row.querySelector(".variant-remove-button").addEventListener("click", () => {
    row.remove();
    if (!variantRows.children.length) {
      addVariantRow();
    }
  });

  variantRows.appendChild(row);
}

function collectVariants() {
  return Array.from(variantRows.querySelectorAll(".variant-row"))
    .map((row) => ({
      id: row.querySelector(".variant-id-input").value.trim(),
      label: row.querySelector(".variant-label-input").value.trim(),
      price: Number(row.querySelector(".variant-price-input").value),
      stock: Number(row.querySelector(".variant-stock-input").value)
    }))
    .filter((variant) => variant.label && variant.price > 0 && variant.stock >= 0);
}

function normalizeProduct(product) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [
        {
          id: "default",
          label: "Reguler",
          price: Number(product.price || 0),
          stock: Number(product.stock || 0)
        }
      ];

  return {
    ...product,
    variants
  };
}

function sumVariantStock(variants) {
  return variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function findLowestVariantPrice(variants) {
  return Math.min(...variants.map((variant) => Number(variant.price || 0)));
}

async function loadOrders(showLoadingState = true) {
  const token = getSavedToken();

  if (!isAdminAuthenticated || !token) {
    adminOrderList.innerHTML = "<p>Silakan login untuk melihat data checkout.</p>";
    adminCompleteOrderList.innerHTML = "<p>Silakan login untuk melihat data checkout.</p>";
    adminDeniedOrderList.innerHTML = "<p>Silakan login untuk melihat data checkout.</p>";
    return;
  }

  if (showLoadingState) {
    adminOrderList.innerHTML = "<p>Memuat checkout...</p>";
    adminCompleteOrderList.innerHTML = "<p>Memuat checkout...</p>";
    adminDeniedOrderList.innerHTML = "<p>Memuat checkout...</p>";
  }

  try {
    const response = await fetch("/api/orders", {
      headers: {
        "x-admin-token": token
      }
    });
    const orders = await response.json();
    if (!response.ok) {
      throw new Error(orders.message || "Gagal memuat checkout.");
    }

    if (!orders.length) {
      adminOrderList.innerHTML = "<p>Belum ada checkout aktif.</p>";
      adminCompleteOrderList.innerHTML = "<p>Belum ada order selesai.</p>";
      adminDeniedOrderList.innerHTML = "<p>Belum ada order ditolak.</p>";
      return;
    }

    const activeOrders = orders.filter(
      (order) => order.status !== "Selesai" && order.paymentStatus !== "Ditolak"
    );
    const completedOrders = orders.filter((order) => order.status === "Selesai");
    const deniedOrders = orders.filter((order) => order.paymentStatus === "Ditolak");

    renderOrderSection(adminOrderList, activeOrders, false);
    renderOrderSection(adminCompleteOrderList, completedOrders, true);
    renderOrderSection(adminDeniedOrderList, deniedOrders, true, true);
  } catch (error) {
    adminOrderList.innerHTML = `<p>${error.message}</p>`;
    adminCompleteOrderList.innerHTML = `<p>${error.message}</p>`;
    adminDeniedOrderList.innerHTML = `<p>${error.message}</p>`;
  }
}

function renderOrderSection(container, orders, isCompleteSection, isDeniedSection = false) {
  if (!orders.length) {
    container.innerHTML = isCompleteSection
      ? isDeniedSection
        ? "<p>Belum ada order ditolak.</p>"
        : "<p>Belum ada order selesai.</p>"
      : "<p>Belum ada checkout aktif.</p>";
    return;
  }

  container.innerHTML = "";
  orders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";
    const actionLabel = order.status === "Baru" ? "Proses Order" : "Tandai Selesai";
    const nextStatus = order.status === "Baru" ? "Diproses" : "Selesai";
    const isWhatsAppOrder = order.paymentMethod === "WhatsApp Penjual";
    const canProgressOrder =
      order.paymentStatus === "Sudah Dibayar" ||
      (isWhatsAppOrder && order.paymentStatus === "Menunggu Konfirmasi");
    const showPaymentButton = !isWhatsAppOrder && order.paymentStatus !== "Sudah Dibayar";
    const showDeniedButton =
      order.paymentStatus === "Menunggu Verifikasi" || order.paymentStatus === "Menunggu Konfirmasi";
    const paymentButtonLabel = order.paymentStatus === "Ditolak" ? "Verifikasi Ulang" : "Verifikasi Pembayaran";
    const nextPaymentStatus = "Sudah Dibayar";

    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <h4>${order.customerName}</h4>
          <p class="muted">${formatDate(order.createdAt)} • ${order.status}</p>
        </div>
        <strong>${formatCurrency(order.total)}</strong>
      </div>
      <p class="muted">${order.phone}</p>
      <p class="muted">${order.address}</p>
      <div class="order-meta-grid">
        <div>
          <span class="muted">Metode Bayar</span>
          <strong>${order.paymentMethod || "-"}</strong>
        </div>
        <div>
          <span class="muted">Pengirim</span>
          <strong>${order.senderName || "-"}</strong>
        </div>
      </div>
      <p class="muted">${order.transferNote || "Tanpa catatan transfer."}</p>
      ${
        order.paymentProofUrl
          ? `<a class="payment-proof-link" href="${order.paymentProofUrl}" target="_blank" rel="noreferrer">Lihat Bukti Transfer</a>`
          : ""
      }
      <div class="order-item-list">
        ${order.items
          .map(
            (item) => `
            <div class="cart-row">
              <span>${item.name} x${item.quantity}</span>
              <strong>${formatCurrency(item.subtotal)}</strong>
            </div>
          `
          )
          .join("")}
      </div>
      <p class="muted">${order.notes || "Tanpa catatan."}</p>
      ${
        isCompleteSection
          ? ""
          : `<div class="order-card-footer">
              <div class="order-badge-group">
                <span class="status-badge status-${order.status.toLowerCase()}">${order.status}</span>
                <span class="status-badge payment-status-${slugify(order.paymentStatus || "Menunggu Verifikasi")}">${order.paymentStatus || "Menunggu Verifikasi"}</span>
              </div>
              <div class="product-action-group">
                ${showDeniedButton ? `<button class="danger-button order-deny-button" type="button">Denied Pembayaran</button>` : ""}
                ${showPaymentButton ? `<button class="secondary-button order-payment-button" type="button">${paymentButtonLabel}</button>` : ""}
                <button class="primary-button order-status-button" type="button" ${canProgressOrder ? "" : "disabled"}>${actionLabel}</button>
              </div>
            </div>`
      }
    `;

    if (!isCompleteSection && showPaymentButton) {
      const btn = card.querySelector(".order-payment-button");
      btn.addEventListener("click", async () => {
        const originalText = btn.textContent;
        btn.innerHTML = `<span class="spinner"></span> Loading...`;
        btn.disabled = true;
        try {
          await updatePaymentStatus(order.id, nextPaymentStatus);
          showNotification("Status pembayaran berhasil diperbarui.");
        } catch (error) {
          showNotification(error.message || "Gagal memperbarui status.");
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }

    if (!isCompleteSection && showDeniedButton) {
      const btn = card.querySelector(".order-deny-button");
      btn.addEventListener("click", async () => {
        const originalText = btn.textContent;
        btn.innerHTML = `<span class="spinner"></span> Loading...`;
        btn.disabled = true;
        try {
          await updatePaymentStatus(order.id, "Ditolak");
          showNotification("Pembayaran ditolak.");
        } catch (error) {
          showNotification(error.message || "Gagal menolak pembayaran.");
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }

    if (!isCompleteSection) {
      const btn = card.querySelector(".order-status-button");
      btn.addEventListener("click", async () => {
        const originalText = btn.textContent;
        btn.innerHTML = `<span class="spinner"></span> Loading...`;
        btn.disabled = true;
        try {
          await updateOrderStatus(order.id, nextStatus);
          showNotification(`Order berhasil diubah ke ${nextStatus}.`);
        } catch (error) {
          showNotification(error.message || "Gagal memperbarui status order.");
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }

    container.appendChild(card);
  });
}

function connectOrderStream(token) {
  disconnectOrderStream();

  orderEventSource = new EventSource(`/api/orders/stream?token=${encodeURIComponent(token)}`);

  orderEventSource.addEventListener("order:created", () => {
    loadOrders(false);
  });

  orderEventSource.addEventListener("order:updated", () => {
    loadOrders(false);
  });

  orderEventSource.onerror = () => {
    if (!isAdminAuthenticated) {
      disconnectOrderStream();
    }
  };
}

function disconnectOrderStream() {
  if (!orderEventSource) {
    return;
  }

  orderEventSource.close();
  orderEventSource = null;
}

async function updateOrderStatus(orderId, status) {
  if (!isAdminAuthenticated) {
    alert("Verifikasi token admin terlebih dahulu.");
    return;
  }

  try {
    const response = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getSavedToken()
      },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Gagal update status order.");
    }
    loadOrders(false);
  } catch (error) {
    alert(error.message);
  }
}

async function updatePaymentStatus(orderId, paymentStatus) {
  if (!isAdminAuthenticated) {
    alert("Verifikasi token admin terlebih dahulu.");
    return;
  }

  try {
    const response = await fetch(`/api/orders/${orderId}/payment-status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getSavedToken()
      },
      body: JSON.stringify({ paymentStatus })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Gagal update status pembayaran.");
    }
    loadOrders(false);
  } catch (error) {
    alert(error.message);
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function createPlaceholderImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#ebe4d8" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b655d" font-family="Arial, sans-serif" font-size="32">
        Produk
      </text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function showNotification(message, duration = 2000) {
  const notification = document.createElement("div");
  notification.className = "toast-notification";
  notification.innerHTML = `
    <div class="toast-content">${message}</div>
    <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("fade-out");
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, duration);
}
