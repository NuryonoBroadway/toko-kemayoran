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
const adminProductCount = document.getElementById("admin-product-count");
const adminTotalStock = document.getElementById("admin-total-stock");
const adminActiveOrderCount = document.getElementById("admin-active-order-count");
const adminCompleteOrderCount = document.getElementById("admin-complete-order-count");
const adminProductToolbarCount = document.getElementById("admin-product-toolbar-count");
const adminVariantToolbarCount = document.getElementById("admin-variant-toolbar-count");

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
    formMessage.textContent = "Login admin terlebih dahulu.";
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span> Loading...`;
  btn.disabled = true;

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
    btn.textContent = originalText;
    btn.disabled = false;
  } catch (error) {
    formMessage.textContent = error.message;
    btn.textContent = originalText;
    btn.disabled = false;
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

  const btn = loginForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span> Loading...`;
  btn.disabled = true;

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
    btn.textContent = originalText;
    btn.disabled = false;
  } catch (error) {
    isAdminAuthenticated = false;
    sessionStorage.removeItem("adminToken");
    disconnectOrderStream();
    syncAdminControls();
    authMessage.textContent = error.message;
    btn.textContent = originalText;
    btn.disabled = false;
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
      updateProductSummaryMetrics([]);
      adminProductList.innerHTML = "<p>Belum ada produk.</p>";
      return;
    }

    updateProductSummaryMetrics(products);
    adminProductList.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "admin-product-card";
      const totalStock = sumVariantStock(product.variants);
      const variantCount = product.variants.length;
      const previewVariants = product.variants.slice(0, 3);
      const hiddenVariantCount = Math.max(variantCount - previewVariants.length, 0);
      card.innerHTML = `
        <div class="admin-product-media">
          <img class="admin-product-image" src="${product.imageUrl || placeholderImage}" alt="${product.name}" />
          <div class="admin-product-media-overlay">
            <span class="category-badge">${product.category}</span>
            <span class="stock-badge">${totalStock} stok</span>
          </div>
        </div>
        <div class="admin-product-content">
          <div class="admin-product-header">
            <div class="admin-product-title-group">
              <h4>${product.name}</h4>
              <p class="muted">${product.description || "Tidak ada deskripsi."}</p>
            </div>
            <div class="admin-product-price-box">
              <span class="muted">Mulai dari</span>
              <strong>${formatCurrency(findLowestVariantPrice(product.variants))}</strong>
            </div>
          </div>
          <div class="admin-product-meta-row">
            <span class="info-chip">${variantCount} varian</span>
            <span class="info-chip">${totalStock} stok</span>
          </div>
          <div class="admin-variant-preview-list">
            ${previewVariants
              .map(
                (variant) => `
                  <div class="admin-variant-preview-card">
                    <div class="admin-variant-preview-top">
                      <strong>${variant.label}</strong>
                      <span>${formatWeight(variant.weightGrams)}</span>
                    </div>
                    <div class="admin-variant-preview-bottom">
                      <span>${formatCurrency(variant.price)}</span>
                      <span>${variant.stock} stok</span>
                    </div>
                  </div>
                `
              )
              .join("")}
            ${hiddenVariantCount ? `<div class="admin-variant-more">+${hiddenVariantCount} varian lainnya</div>` : ""}
          </div>
          <div class="admin-product-footer">
            <div class="product-action-group">
              <button class="secondary-button product-edit-button" type="button" ${isAdminAuthenticated ? "" : "disabled"}>Edit</button>
              <button class="danger-button product-delete-button" type="button" ${isAdminAuthenticated ? "" : "disabled"}>Hapus</button>
            </div>
          </div>
        </div>
      `;

      card.querySelector(".product-edit-button").addEventListener("click", () => {
        if (!isAdminAuthenticated) {
          return;
        }
        prepareEditMode(product);
        productModal.classList.remove("hidden");
      });

      const deleteBtn = card.querySelector(".product-delete-button");
      deleteBtn.addEventListener("click", async () => {
        if (!isAdminAuthenticated) {
          return;
        }

        const originalText = deleteBtn.textContent;
        deleteBtn.innerHTML = `<span class="spinner"></span>...`;
        deleteBtn.disabled = true;

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
          showNotification("Produk berhasil dihapus.");
        } catch (error) {
          showNotification(error.message || "Gagal menghapus produk.");
          deleteBtn.textContent = originalText;
          deleteBtn.disabled = false;
        }
      });

      adminProductList.appendChild(card);
    });
  } catch (_error) {
    updateProductSummaryMetrics([]);
    adminProductList.innerHTML = "<p>Gagal memuat produk.</p>";
  }
}

function updateProductSummaryMetrics(products) {
  const totalProducts = products.length;
  const totalStock = products.reduce((sum, product) => sum + sumVariantStock(product.variants), 0);
  const totalVariants = products.reduce((sum, product) => sum + product.variants.length, 0);

  if (adminProductCount) {
    adminProductCount.textContent = String(totalProducts);
  }

  if (adminTotalStock) {
    adminTotalStock.textContent = String(totalStock);
  }

  if (adminProductToolbarCount) {
    adminProductToolbarCount.textContent = `${totalProducts} produk`;
  }

  if (adminVariantToolbarCount) {
    adminVariantToolbarCount.textContent = `${totalVariants} varian`;
  }
}

function prepareCreateMode() {
  form.reset();
  editingProductIdInput.value = "";
  productModalTitle.textContent = "Produk Baru";
  submitProductButton.textContent = "Upload Produk";
  formMessage.textContent = "";
  variantRows.innerHTML = "";
  addVariantRow({ label: "1/4 kg", price: "", stock: "", weightGrams: 250 });
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
    <label>
      Berat (gram)
      <input class="variant-weight-input" type="number" min="1" step="1" placeholder="250" value="${variant.weightGrams ?? ""}" />
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
      stock: Number(row.querySelector(".variant-stock-input").value),
      weightGrams: Number(row.querySelector(".variant-weight-input").value)
    }))
    .filter((variant) => variant.label && variant.price > 0 && variant.stock >= 0 && variant.weightGrams > 0);
}

function normalizeProduct(product) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [
        {
          id: "default",
          label: "Reguler",
          price: Number(product.price || 0),
          stock: Number(product.stock || 0),
          weightGrams: Number(product.weightGrams || 250)
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

function formatWeight(value) {
  const grams = Number(value || 0);
  if (!grams) {
    return "-";
  }

  if (grams >= 1000 && grams % 1000 === 0) {
    return `${grams / 1000} kg`;
  }

  return `${grams} g`;
}

async function loadOrders(showLoadingState = true) {
  const token = getSavedToken();

  if (!isAdminAuthenticated || !token) {
    if (adminActiveOrderCount) {
      adminActiveOrderCount.textContent = "0";
    }
    if (adminCompleteOrderCount) {
      adminCompleteOrderCount.textContent = "0";
    }
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

    if (adminActiveOrderCount) {
      adminActiveOrderCount.textContent = String(activeOrders.length);
    }
    if (adminCompleteOrderCount) {
      adminCompleteOrderCount.textContent = String(completedOrders.length);
    }

    renderOrderSection(adminOrderList, activeOrders, false);
    renderOrderSection(adminCompleteOrderList, completedOrders, true);
    renderOrderSection(adminDeniedOrderList, deniedOrders, true, true);
  } catch (error) {
    if (adminActiveOrderCount) {
      adminActiveOrderCount.textContent = "0";
    }
    if (adminCompleteOrderCount) {
      adminCompleteOrderCount.textContent = "0";
    }
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
    const canShowReceipt = order.status === "Diproses" || order.status === "Selesai";
    const receiptActionsHtml = canShowReceipt
      ? `
          <button class="secondary-button order-receipt-preview-button" type="button">Lihat Struk</button>
          <button class="secondary-button order-receipt-download-button" type="button">Unduh Struk</button>
        `
      : "";

    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <h4>${order.customerName}</h4>
          <p class="muted">${formatDate(order.createdAt)} • ${order.status} • ID: ${order.id}</p>
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
        <div>
          <span class="muted">Pengiriman</span>
          <strong>${formatShippingLabel(order)}</strong>
        </div>
        <div>
          <span class="muted">Estimasi</span>
          <strong>${order.shippingEtd || "-"}</strong>
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
            <div class="cart-row order-item-row">
              <div class="order-item-copy">
                <strong>${item.name}</strong>
                <span class="muted">${item.variantLabel || "Reguler"} • Qty ${item.quantity}</span>
              </div>
              <strong>${formatCurrency(item.subtotal)}</strong>
            </div>
          `
          )
          .join("")}
        <div class="cart-row order-summary-row">
          <span>Subtotal Produk</span>
          <strong>${formatCurrency(order.subtotal || sumOrderItems(order.items))}</strong>
        </div>
        <div class="cart-row order-summary-row">
          <span>Ongkir</span>
          <strong>${formatCurrency(order.shippingCost || 0)}</strong>
        </div>
      </div>
      <p class="muted">${order.notes || "Tanpa catatan."}</p>
      ${
        isCompleteSection
          ? `<div class="order-card-footer receipt-only-footer">
              <div class="order-badge-group">
                <span class="status-badge status-${slugify(order.status || "Selesai")}">${order.status}</span>
                <span class="status-badge payment-status-${slugify(order.paymentStatus || "Sudah Dibayar")}">${order.paymentStatus || "Sudah Dibayar"}</span>
              </div>
              <div class="product-action-group">
                ${receiptActionsHtml}
              </div>
            </div>`
          : `<div class="order-card-footer">
              <div class="order-badge-group">
                <span class="status-badge status-${order.status.toLowerCase()}">${order.status}</span>
                <span class="status-badge payment-status-${slugify(order.paymentStatus || "Menunggu Verifikasi")}">${order.paymentStatus || "Menunggu Verifikasi"}</span>
              </div>
              <div class="product-action-group">
                ${receiptActionsHtml}
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
          await updateOrderStatus(order.id, "Ditolak");
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

    if (canShowReceipt) {
      const previewBtn = card.querySelector(".order-receipt-preview-button");
      const downloadBtn = card.querySelector(".order-receipt-download-button");

      previewBtn?.addEventListener("click", async () => {
        await withButtonLoading(previewBtn, "Lihat Struk", () => openReceiptPreview(order));
      });

      downloadBtn?.addEventListener("click", async () => {
        await withButtonLoading(downloadBtn, "Unduh Struk", () => downloadReceiptHtml(order));
      });
    }

    container.appendChild(card);
  });
}

function openReceiptPreview(order) {
  const token = getSavedToken();
  const previewUrl = `/api/orders/${encodeURIComponent(order.id)}/receipt?token=${encodeURIComponent(token)}`;
  const receiptWindow = window.open(previewUrl, "_blank");
  if (!receiptWindow) {
    showNotification("Popup diblokir browser. Izinkan popup untuk melihat struk.");
    throw new Error("Popup diblokir browser.");
  }
}

async function downloadReceiptHtml(order) {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/receipt.pdf`, {
      headers: {
        "x-admin-token": getSavedToken()
      }
    });

    if (!response.ok) {
      let message = "Gagal mengunduh struk PDF.";
      try {
        const result = await response.json();
        message = result.message || message;
      } catch (_error) {
        // Ignore body parse failure
      }
      throw new Error(message);
    }

    const file = await response.blob();
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `struk-${order.id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showNotification(error.message || "Gagal mengunduh struk PDF.");
    throw error;
  }
}

async function withButtonLoading(button, originalText, action) {
  if (!button) {
    await action();
    return;
  }

  button.innerHTML = `<span class="spinner"></span> Loading...`;
  button.disabled = true;

  try {
    await action();
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
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
    alert("Login admin terlebih dahulu.");
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
    alert("Login admin terlebih dahulu.");
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

function formatShippingLabel(order) {
  const parts = [order.shippingCourierName, order.shippingService].filter(Boolean);
  return parts.length ? parts.join(" ") : "-";
}

function sumOrderItems(items) {
  return Array.isArray(items)
    ? items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    : 0;
}
