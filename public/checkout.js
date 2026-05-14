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
      throw new Error(result.message || "Checkout gagal.");
    }

    if (selectedPaymentMethod === "WhatsApp Penjual" && paymentInfo?.sellerWhatsAppNumber) {
      const targetUrl = buildWhatsAppUrl(paymentInfo.sellerWhatsAppNumber, result);
      localStorage.removeItem("cart");
      sessionStorage.setItem("pendingToast", `Pesanan berhasil dibuat. ID: ${result.id}`);
      window.location.href = targetUrl;
      return;
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

        // Selalu fetch ongkir setelah lokasi dipilih untuk mengetahui kurir yang tersedia
        fetchShippingOptions();
      });
      destinationSearchResults.appendChild(button);
    });
  } catch (error) {
    destinationSearchResults.innerHTML = `<div class="location-search-state">Lokasi tidak ditemukan</div>`;
  }
}

function renderSelectedDestination() {
  if (!selectedDestination) {
    selectedDestinationContainer.classList.add("hidden");
    selectedDestinationContainer.innerHTML = "";
    return;
  }

  // Jangan sembunyikan bar pencarian (searchLabel), biarkan tetap terlihat
  selectedDestinationContainer.classList.remove("hidden");
  selectedDestinationContainer.innerHTML = `
    <div class="selected-destination-info">
      <span class="info-chip success">Lokasi Terpilih: ${selectedDestination.label}</span>
    </div>
  `;
}

function renderCourierPicker() {
  if (!selectedDestination) {
    courierPicker.innerHTML = "";
    return;
  }

  if (!paymentInfo?.availableCouriers?.length) {
    courierPicker.innerHTML = "<p class=\"muted\">Belum ada kurir yang dikonfigurasi.</p>";
    return;
  }

  if (!shippingOptions.length && selectedDestination) {
    courierPicker.innerHTML = "<p class=\"muted\">Tidak ada kurir yang tersedia untuk rute ini.</p>";
    return;
  }

  // Ambil unik kurir dari hasil API (agar tidak ada chip duplikat jika satu kurir punya banyak layanan)
  const uniqueCouriers = [];
  const seenCodes = new Set();

  shippingOptions.forEach(opt => {
    if (!seenCodes.has(opt.courierCode)) {
      // Opsi tambahan: Cek apakah kurir ini ada di config .env (paymentInfo.availableCouriers)
      const isAllowed = paymentInfo.availableCouriers.some(c => opt.courierCode.toLowerCase().includes(c.toLowerCase()));

      if (isAllowed) {
        seenCodes.add(opt.courierCode);
        uniqueCouriers.push({
          code: opt.courierCode,
          name: opt.courierName
        });
      }
    }
  });

  courierPicker.innerHTML = uniqueCouriers
    .map((courier) => {
      const active = courier.code === selectedCourierCode;
      return `
        <button
          type="button"
          class="courier-chip${active ? " selected" : ""}"
          data-courier-code="${courier.code}"
        >
          ${courier.name}
        </button>
      `;
    })
    .join("");

  courierPicker.querySelectorAll("[data-courier-code]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCourierCode = button.dataset.courierCode || "";

      // Auto-select opsi pertama untuk kurir yang baru dipilih
      const filtered = shippingOptions.filter(opt =>
        opt.courierCode.toLowerCase() === selectedCourierCode.toLowerCase()
      );
      selectedShippingOption = filtered.length > 0 ? filtered[0] : null;

      renderCourierPicker();
      renderShippingOptions();
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
  const shippingLine = order.shippingCourierName
    ? `Pengiriman: ${order.shippingCourierName}`
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
  if (!cart.length) {
    checkoutItems.innerHTML = "<p>Keranjang masih kosong. Tambahkan produk dari halaman toko.</p>";
    checkoutSummary.textContent = "0 item";
    document.getElementById("checkout-subtotal").textContent = formatCurrency(0);
    document.getElementById("checkout-shipping").textContent = "Belum dipilih";
    document.getElementById("checkout-weight").textContent = "0 g";
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
  document.getElementById("checkout-weight").textContent = formatWeight(getCartWeightGrams());
  document.getElementById("checkout-shipping").textContent = selectedShippingOption
    ? formatCurrency(shippingCost)
    : "Belum dipilih";
  checkoutTotal.textContent = formatCurrency(total);
}

async function fetchShippingOptions() {
  if (!selectedDestination || getCartWeightGrams() <= 0) {
    renderShippingOptions();
    return;
  }

  shippingOptionsContainer.innerHTML = "<p class=\"muted\">Memuat ongkir...</p>";
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

    // Jika belum ada kurir yang dipilih, pilih kurir pertama yang tersedia dari API
    if (!selectedCourierCode && shippingOptions.length > 0) {
      selectedCourierCode = shippingOptions[0].courierCode;
    }

    // Jika kurir terpilih tidak lagi tersedia di hasil terbaru, reset pilihan kurir
    if (selectedCourierCode) {
      const isStillAvailable = shippingOptions.some(opt => opt.courierCode.toLowerCase() === selectedCourierCode.toLowerCase());
      if (!isStillAvailable) {
        selectedCourierCode = shippingOptions.length > 0 ? shippingOptions[0].courierCode : null;
      }
    }

    // Selalu pastikan opsi pertama dipilih untuk kurir aktif jika belum ada pilihan
    if (selectedCourierCode && !selectedShippingOption) {
      const filtered = shippingOptions.filter(opt => opt.courierCode.toLowerCase() === selectedCourierCode.toLowerCase());
      if (filtered.length > 0) {
        selectedShippingOption = filtered[0];
      }
    }

    renderCourierPicker();
    renderShippingOptions();
  } catch (error) {
    shippingOptions = [];
    selectedShippingOption = null;
    shippingOptionsContainer.innerHTML = `
      <div class="shipping-error-box">
        <p class="muted">${error.message}</p>
        <button id="retry-shipping-button" class="secondary-button" type="button" style="margin-top: 8px;">Coba Lagi</button>
      </div>
    `;
    renderCourierPicker();
    updateTotals();

    const retryBtn = document.getElementById("retry-shipping-button");
    if (retryBtn) {
      retryBtn.addEventListener("click", fetchShippingOptions);
    }
  }
}

function renderShippingOptions() {
  updateTotals();

  if (!cart.length) {
    shippingOptionsContainer.innerHTML = "<p>Keranjang kosong, ongkir belum bisa dihitung.</p>";
    return;
  }

  if (!selectedDestination) {
    shippingOptionsContainer.innerHTML = "";
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

  const filteredOptions = shippingOptions.filter(option => {
    if (!selectedCourierCode) return true;
    return option.courierCode.toLowerCase() === selectedCourierCode.toLowerCase();
  });

  if (!filteredOptions.length) {
    shippingOptionsContainer.innerHTML = canSubmitWithoutShipping()
      ? "<p class=\"muted\">Belum ada layanan ongkir untuk kurir ini. Anda tetap bisa checkout lewat WhatsApp agar ongkir dikonfirmasi manual oleh penjual.</p>"
      : "<p class=\"muted\">Layanan ongkir tidak tersedia untuk kurir yang dipilih. Klik Cek Ongkir atau pilih kurir lain.</p>";
    return;
  }

  shippingOptionsContainer.innerHTML = "";

  filteredOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shipping-option-card${selectedShippingOption?.courierCode === option.courierCode && selectedShippingOption?.service === option.service ? " selected" : ""}`;

    // Hilangkan baris muted jika nama servis sama dengan nama kurir agar tidak duplikat
    const showService = option.service && option.service !== option.courierName;
    const serviceHtml = showService ? `<div class="muted">${option.service}${option.description ? ` • ${option.description}` : ""}</div>` : "";

    button.innerHTML = `
      <div class="shipping-option-top">
        <div>
          <strong>${option.courierName}</strong>
          ${serviceHtml}
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

  if (grams >= 1000) {
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
    jnecargo: "JNE Cargo",
    sicepat: "SiCepat",
    pos: "POS",
    tiki: "TIKI",
    anteraja: "AnterAja",
    ninja: "Ninja",
    lion: "Lion",
    sap: "SAP",
    jt: "J&T Express"
  };

  return map[value] || value.toUpperCase();
}

function sumOrderItems(items) {
  return Array.isArray(items)
    ? items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    : 0;
}
