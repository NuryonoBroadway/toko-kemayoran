const checkoutItems = document.getElementById("checkout-items");
const checkoutTotal = document.getElementById("checkout-total");
const checkoutSummary = document.getElementById("checkout-summary");
const checkoutForm = document.getElementById("checkout-form");
const checkoutMessage = document.getElementById("checkout-message");
const paymentInfoContainer = document.getElementById("payment-info");
const paymentMethodInputs = Array.from(document.querySelectorAll('input[name="paymentMethod"]'));
const bankTransferFields = document.getElementById("bank-transfer-fields");
const whatsappFields = document.getElementById("whatsapp-fields");
const destinationSearchInput = document.getElementById("destination-search-input");
const destinationSearchResults = document.getElementById("destination-search-results");
const selectedDestinationContainer = document.getElementById("selected-destination");
const shippingOptionsContainer = document.getElementById("shipping-options");
const shippingWeightBadge = document.getElementById("shipping-weight-badge");
const refreshShippingButton = document.getElementById("refresh-shipping-button");
const courierPicker = document.getElementById("courier-picker");

let paymentInfo = null;
let shippingOptions = [];
let selectedShippingOption = null;
let selectedDestination = null;
let selectedCourierCode = "";
let searchDebounce = null;

let cart = normalizeCart(readCart());

loadPaymentInfo();
renderCheckout();
syncPaymentMethodFields();
renderCourierPicker();

destinationSearchInput.addEventListener("input", () => {
  const keyword = destinationSearchInput.value.trim();
  selectedShippingOption = null;
  shippingOptions = [];

  if (selectedDestination && keyword !== selectedDestination.label) {
    selectedDestination = null;
    renderSelectedDestination();
  }

  renderShippingOptions();

  clearTimeout(searchDebounce);
  if (keyword.length < 3) {
    destinationSearchResults.classList.add("hidden");
    destinationSearchResults.innerHTML = "";
    return;
  }

  searchDebounce = setTimeout(() => {
    searchLocations(keyword);
  }, 250);
});

destinationSearchInput.addEventListener("focus", () => {
  if (destinationSearchResults.innerHTML.trim()) {
    destinationSearchResults.classList.remove("hidden");
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".location-search-box")) {
    destinationSearchResults.classList.add("hidden");
  }
});

refreshShippingButton.addEventListener("click", async () => {
  if (!canCalculateShipping()) {
    checkoutMessage.textContent = "Pilih lokasi tujuan dan kurir lebih dulu untuk cek ongkir.";
    return;
  }

  checkoutMessage.textContent = "";
  await fetchShippingOptions();
});

paymentMethodInputs.forEach((input) => {
  input.addEventListener("change", syncPaymentMethodFields);
});

function canSubmitWithoutShipping() {
  return getSelectedPaymentMethod() === "WhatsApp Penjual";
}

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!cart.length) {
    checkoutMessage.textContent = "Keranjang kosong.";
    return;
  }

  if (!selectedDestination) {
    checkoutMessage.textContent = "Pilih lokasi tujuan dari hasil pencarian.";
    return;
  }

  if (!selectedShippingOption && !canSubmitWithoutShipping()) {
    checkoutMessage.textContent = "Pilih layanan pengiriman terlebih dahulu.";
    return;
  }

  const submitButton = checkoutForm.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;
  submitButton.innerHTML = `<span class="spinner"></span> Loading...`;
  submitButton.disabled = true;

  checkoutMessage.textContent = "Mengirim pesanan...";
  const formData = new FormData(checkoutForm);
  const selectedPaymentMethod = getSelectedPaymentMethod();
  const pendingWhatsAppWindow =
    selectedPaymentMethod === "WhatsApp Penjual" && paymentInfo?.sellerWhatsAppNumber
      ? window.open("about:blank", "_blank")
      : null;

  const addressDetail = document.getElementById("address-detail").value.trim();
  const fullAddress = `${addressDetail}, ${selectedDestination.label}`;

  formData.set("customerName", String(formData.get("customerName") || "").trim());
  formData.set("phone", String(formData.get("phone") || "").trim());
  formData.set("address", fullAddress);
  formData.set("addressDetail", addressDetail);
  formData.set("provinceId", "");
  formData.set("provinceName", "");
  formData.set("regencyId", "");
  formData.set("regencyName", "");
  formData.set("districtId", "");
  formData.set("districtName", "");
  formData.set("villageId", selectedDestination.id);
  formData.set("villageName", selectedDestination.label);
  formData.set("notes", String(formData.get("notes") || "").trim());
  formData.set("paymentMethod", selectedPaymentMethod);
  formData.set("senderName", String(formData.get("senderName") || "").trim());
  formData.set("transferNote", String(formData.get("transferNote") || "").trim());
  formData.set("shippingCost", String(selectedShippingOption?.cost ?? 0));
  formData.set("shippingCourierCode", selectedShippingOption?.courierCode || "");
  formData.set("shippingCourierName", selectedShippingOption?.courierName || "");
  formData.set("shippingService", selectedShippingOption?.service || "");
  formData.set("shippingServiceDescription", selectedShippingOption?.description || "");
  formData.set("shippingEtd", selectedShippingOption?.etd || "");
  formData.set("totalWeightGrams", String(getCartWeightGrams()));
  formData.set(
    "items",
    JSON.stringify(
      cart.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity
      }))
    )
  );

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!response.ok) {
      if (pendingWhatsAppWindow) {
        pendingWhatsAppWindow.close();
      }
      throw new Error(result.message || "Checkout gagal.");
    }

    if (selectedPaymentMethod === "WhatsApp Penjual" && paymentInfo?.sellerWhatsAppNumber) {
      const targetUrl = buildWhatsAppUrl(paymentInfo.sellerWhatsAppNumber, result);
      if (pendingWhatsAppWindow) {
        pendingWhatsAppWindow.location.href = targetUrl;
      } else {
        window.location.href = targetUrl;
      }
    }

    localStorage.removeItem("cart");
    cart = [];
    shippingOptions = [];
    selectedShippingOption = null;
    selectedDestination = null;
    checkoutForm.reset();
    destinationSearchResults.innerHTML = "";
    destinationSearchResults.classList.add("hidden");
    syncPaymentMethodFields();
    renderSelectedDestination();
    renderCheckout();
    renderShippingOptions();
    sessionStorage.setItem("pendingToast", `Pesanan berhasil dibuat. ID: ${result.id}`);
    window.location.href = "/";
  } catch (error) {
    if (pendingWhatsAppWindow) {
      pendingWhatsAppWindow.close();
    }
    checkoutMessage.textContent = error.message;
    submitButton.textContent = originalText;
    submitButton.disabled = false;
  }
});

async function loadPaymentInfo() {
  paymentInfoContainer.innerHTML = "<p>Memuat info pembayaran...</p>";

  try {
    const response = await fetch("/api/payment-info");
    const info = await response.json();
    paymentInfo = info;
    selectedCourierCode = selectedCourierCode || info.availableCouriers?.[0] || "";
    paymentInfoContainer.innerHTML = `
      <div class="payment-info-item">
        <span class="muted">Bank</span>
        <strong>${info.bankName}</strong>
      </div>
      <div class="payment-info-item">
        <span class="muted">Nomor Rekening</span>
        <strong>${info.bankAccountNumber}</strong>
      </div>
      <div class="payment-info-item">
        <span class="muted">Atas Nama</span>
        <strong>${info.bankAccountHolder}</strong>
      </div>
      <div class="payment-info-item">
        <span class="muted">WhatsApp Penjual</span>
        <strong>${formatWhatsAppNumber(info.sellerWhatsAppNumber)}</strong>
      </div>
    `;
    renderCourierPicker();
  } catch (_error) {
    paymentInfoContainer.innerHTML = "<p>Info pembayaran gagal dimuat.</p>";
  }
}

async function searchLocations(keyword) {
  destinationSearchResults.classList.remove("hidden");
  destinationSearchResults.innerHTML = "<div class=\"location-search-state\">Mencari lokasi...</div>";

  try {
    const response = await fetch(`/api/locations/search?search=${encodeURIComponent(keyword)}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Gagal mencari lokasi.");
    }

    if (!result.length) {
      destinationSearchResults.innerHTML = "<div class=\"location-search-state\">Lokasi tidak ditemukan.</div>";
      return;
    }

    destinationSearchResults.innerHTML = "";
    result.forEach((location) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "location-result-item";
      button.innerHTML = `
        <strong>${location.label}</strong>
      `;
      button.addEventListener("click", () => {
        selectedDestination = location;
        destinationSearchInput.value = location.label;
        destinationSearchResults.classList.add("hidden");
        shippingOptions = [];
        selectedShippingOption = null;
        renderSelectedDestination();
        renderShippingOptions();
        if (selectedCourierCode) {
          fetchShippingOptions();
        }
      });
      destinationSearchResults.appendChild(button);
    });
  } catch (error) {
    destinationSearchResults.innerHTML = `<div class="location-search-state">${error.message}</div>`;
  }
}

function renderSelectedDestination() {
  if (!selectedDestination) {
    selectedDestinationContainer.classList.add("hidden");
    selectedDestinationContainer.innerHTML = "";
    return;
  }

  selectedDestinationContainer.classList.remove("hidden");
  selectedDestinationContainer.innerHTML = `
    <div class="selected-destination-card">
      <div>
        <strong>${selectedDestination.label}</strong>
      </div>
      <button id="clear-destination-button" class="secondary-button" type="button">Ganti</button>
    </div>
  `;

  selectedDestinationContainer.querySelector("#clear-destination-button").addEventListener("click", () => {
    selectedDestination = null;
    selectedShippingOption = null;
    shippingOptions = [];
    destinationSearchInput.value = "";
    renderSelectedDestination();
    renderShippingOptions();
  });
}

function renderCourierPicker() {
  if (!paymentInfo?.availableCouriers?.length) {
    courierPicker.innerHTML = "<p class=\"muted\">Belum ada kurir yang dikonfigurasi.</p>";
    return;
  }

  courierPicker.innerHTML = paymentInfo.availableCouriers
    .map((code) => {
      const active = code === selectedCourierCode;
      return `
        <button
          type="button"
          class="courier-chip${active ? " selected" : ""}"
          data-courier-code="${code}"
        >
          ${formatCourierName(code)}
        </button>
      `;
    })
    .join("");

  courierPicker.querySelectorAll("[data-courier-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedCourierCode = button.dataset.courierCode || "";
      selectedShippingOption = null;
      shippingOptions = [];
      renderCourierPicker();
      renderShippingOptions();

      if (selectedDestination) {
        await fetchShippingOptions();
      }
    });
  });
}

function syncPaymentMethodFields() {
  const selectedPaymentMethod = getSelectedPaymentMethod();
  const isBankTransfer = selectedPaymentMethod === "Transfer Bank";
  const senderNameInput = checkoutForm.elements.senderName;
  const paymentProofInput = checkoutForm.elements.paymentProof;

  bankTransferFields.classList.toggle("hidden", !isBankTransfer);
  whatsappFields.classList.toggle("hidden", isBankTransfer);
  senderNameInput.required = isBankTransfer;
  paymentProofInput.required = isBankTransfer;

  if (!isBankTransfer) {
    senderNameInput.value = "";
    checkoutForm.elements.transferNote.value = "";
    paymentProofInput.value = "";
  }

  if (!isBankTransfer && !selectedShippingOption) {
    checkoutMessage.textContent = "Jika ongkir belum tersedia, pesanan tetap bisa dikirim ke WhatsApp penjual untuk konfirmasi manual.";
    return;
  }

  if (checkoutMessage.textContent.includes("konfirmasi manual")) {
    checkoutMessage.textContent = "";
  }
}

function getSelectedPaymentMethod() {
  return paymentMethodInputs.find((input) => input.checked)?.value || "Transfer Bank";
}

function buildWhatsAppUrl(number, order) {
  const itemLines = order.items
    .map((item) => `- ${item.name} ${item.variantLabel ? `(${item.variantLabel}) ` : ""}x${item.quantity} (${formatCurrency(item.subtotal)})`)
    .join("\n");
  const courierLabel = [order.shippingCourierName, order.shippingService].filter(Boolean).join(" ");
  const shippingLine = courierLabel
    ? `Pengiriman: ${courierLabel}`
    : "Pengiriman: Ongkir akan dikonfirmasi penjual";
  const shippingCostLine =
    Number(order.shippingCost || 0) > 0
      ? `Ongkos Kirim: ${formatCurrency(order.shippingCost || 0)}`
      : "Ongkos Kirim: Akan dikonfirmasi penjual";
  const text = [
    "Halo, saya sudah membuat pesanan.",
    `ID Order: ${order.id}`,
    `Nama: ${order.customerName}`,
    `No HP: ${order.phone}`,
    `Alamat: ${order.address}`,
    "Pesanan:",
    itemLines,
    `Subtotal: ${formatCurrency(order.subtotal || sumOrderItems(order.items))}`,
    shippingCostLine,
    shippingLine,
    `Estimasi: ${order.shippingEtd || "-"}`,
    `Total Bayar: ${formatCurrency(order.total || 0)}`
  ].join("\n");
  const normalizedNumber = String(number).replace(/[^\d]/g, "");
  return `https://api.whatsapp.com/send?phone=${normalizedNumber}&text=${encodeURIComponent(text)}`;
}

function renderCheckout() {
  checkoutItems.innerHTML = "";
  shippingWeightBadge.textContent = formatWeight(getCartWeightGrams());

  if (!cart.length) {
    checkoutItems.innerHTML = "<p>Keranjang masih kosong. Tambahkan produk dari halaman toko.</p>";
    checkoutSummary.textContent = "0 item";
    document.getElementById("checkout-subtotal").textContent = formatCurrency(0);
    document.getElementById("checkout-shipping").textContent = "Belum dipilih";
    checkoutTotal.textContent = formatCurrency(0);
    renderShippingOptions();
    return;
  }

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  checkoutSummary.textContent = `${totalItems} item`;

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-row">
        <div>
          <strong>${item.name}</strong>
          <div class="muted">${item.variantLabel || "Reguler"} • Qty ${item.quantity} • ${formatWeight(item.weightGrams * item.quantity)}</div>
        </div>
        <strong>${formatCurrency(item.price * item.quantity)}</strong>
      </div>
    `;
    checkoutItems.appendChild(row);
  });

  updateTotals();
  renderShippingOptions();
}

function updateTotals() {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingCost = selectedShippingOption?.cost || 0;
  const total = subtotal + shippingCost;

  document.getElementById("checkout-subtotal").textContent = formatCurrency(subtotal);
  document.getElementById("checkout-shipping").textContent = selectedShippingOption
    ? formatCurrency(shippingCost)
    : "Belum dipilih";
  checkoutTotal.textContent = formatCurrency(total);
}

async function fetchShippingOptions() {
  if (!canCalculateShipping()) {
    renderShippingOptions();
    return;
  }

  shippingOptionsContainer.innerHTML = "<p>Memuat ongkir...</p>";
  refreshShippingButton.disabled = true;

  try {
    const response = await fetch("/api/shipping/options", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        courierCode: selectedCourierCode,
        destinationId: selectedDestination.id,
        destinationQuery: selectedDestination.destinationQuery,
        weightGrams: getCartWeightGrams()
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Gagal menghitung ongkir.");
    }

    shippingOptions = result.options || [];
    selectedShippingOption = shippingOptions[0] || null;
    renderShippingOptions();
  } catch (error) {
    shippingOptions = [];
    selectedShippingOption = null;
    shippingOptionsContainer.innerHTML = `<p>${error.message}</p>`;
    checkoutMessage.textContent = error.message;
    updateTotals();
  } finally {
    refreshShippingButton.disabled = false;
  }
}

function renderShippingOptions() {
  updateTotals();

  if (!cart.length) {
    shippingOptionsContainer.innerHTML = "<p>Keranjang kosong, ongkir belum bisa dihitung.</p>";
    return;
  }

  if (!selectedDestination) {
    shippingOptionsContainer.innerHTML = "<p class=\"muted\">Cari lalu pilih lokasi tujuan untuk melihat ongkir.</p>";
    return;
  }

  if (!selectedCourierCode) {
    shippingOptionsContainer.innerHTML = "<p class=\"muted\">Pilih kurir terlebih dahulu.</p>";
    return;
  }

  if (!shippingOptions.length) {
    shippingOptionsContainer.innerHTML = canSubmitWithoutShipping()
      ? "<p class=\"muted\">Belum ada layanan ongkir. Anda tetap bisa checkout lewat WhatsApp agar ongkir dikonfirmasi manual oleh penjual.</p>"
      : "<p class=\"muted\">Belum ada layanan ongkir. Klik Cek Ongkir untuk memuat pilihan.</p>";
    return;
  }

  shippingOptionsContainer.innerHTML = "";

  shippingOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shipping-option-card${selectedShippingOption?.courierCode === option.courierCode && selectedShippingOption?.service === option.service ? " selected" : ""}`;
    button.innerHTML = `
      <div class="shipping-option-top">
        <div>
          <strong>${option.courierName}</strong>
          <div class="muted">${option.service}${option.description ? ` • ${option.description}` : ""}</div>
        </div>
        <strong>${formatCurrency(option.cost)}</strong>
      </div>
      <div class="shipping-option-bottom">
        <span class="info-chip">${option.etd ? `${option.etd} hari` : "Estimasi belum ada"}</span>
      </div>
    `;
    button.addEventListener("click", () => {
      selectedShippingOption = option;
      renderShippingOptions();
    });
    shippingOptionsContainer.appendChild(button);
  });
}

function canCalculateShipping() {
  return Boolean(selectedDestination?.id && selectedCourierCode && getCartWeightGrams() > 0);
}

function getCartWeightGrams() {
  return cart.reduce((sum, item) => sum + (Number(item.weightGrams || 0) * Number(item.quantity || 0)), 0);
}

function normalizeCart(currentCart) {
  return currentCart
    .map((item) => ({
      ...item,
      weightGrams: Number(item.weightGrams || 250),
      variantLabel: item.variantLabel || "Reguler"
    }))
    .filter((item) => item.id && item.variantId && item.quantity > 0);
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  } catch (_error) {
    return [];
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatWeight(value) {
  const grams = Number(value || 0);
  if (!grams) {
    return "0 g";
  }

  if (grams >= 1000 && grams % 1000 === 0) {
    return `${grams / 1000} kg`;
  }

  return `${grams} g`;
}

function formatWhatsAppNumber(number) {
  if (!number) {
    return "-";
  }
  return `+${String(number).replace(/[^\d]/g, "")}`;
}

function formatCourierName(code) {
  const value = String(code || "").trim().toLowerCase();
  const map = {
    jne: "JNE",
    sicepat: "SiCepat",
    pos: "POS",
    tiki: "TIKI",
    anteraja: "AnterAja",
    ninja: "Ninja",
    lion: "Lion",
    sap: "SAP"
  };

  return map[value] || value.toUpperCase();
}

function sumOrderItems(items) {
  return Array.isArray(items)
    ? items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    : 0;
}
