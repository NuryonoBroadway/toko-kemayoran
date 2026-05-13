const checkoutItems = document.getElementById("checkout-items");
const checkoutTotal = document.getElementById("checkout-total");
const checkoutSummary = document.getElementById("checkout-summary");
const checkoutForm = document.getElementById("checkout-form");
const checkoutMessage = document.getElementById("checkout-message");
const paymentInfoContainer = document.getElementById("payment-info");
const paymentMethodInputs = Array.from(document.querySelectorAll('input[name="paymentMethod"]'));
const bankTransferFields = document.getElementById("bank-transfer-fields");
const whatsappFields = document.getElementById("whatsapp-fields");

let paymentInfo = null;

let cart = readCart();

loadPaymentInfo();
renderCheckout();
syncPaymentMethodFields();

paymentMethodInputs.forEach((input) => {
  input.addEventListener("change", syncPaymentMethodFields);
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!cart.length) {
    checkoutMessage.textContent = "Keranjang kosong.";
    return;
  }

  if (cart.some((item) => !item.variantId)) {
    checkoutMessage.textContent = "Ada item keranjang lama tanpa varian. Kembali ke toko lalu pilih ulang produknya.";
    return;
  }

  const btn = checkoutForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span> Loading...`;
  btn.disabled = true;

  checkoutMessage.textContent = "Mengirim pesanan...";
  const formData = new FormData(checkoutForm);
  const selectedPaymentMethod = getSelectedPaymentMethod();
  const pendingWhatsAppWindow =
    selectedPaymentMethod === "WhatsApp Penjual" && paymentInfo?.sellerWhatsAppNumber
      ? window.open("about:blank", "_blank")
      : null;
  formData.set("customerName", String(formData.get("customerName") || "").trim());
  formData.set("phone", String(formData.get("phone") || "").trim());
  formData.set("address", String(formData.get("address") || "").trim());
  formData.set("notes", String(formData.get("notes") || "").trim());
  formData.set("paymentMethod", selectedPaymentMethod);
  formData.set("senderName", String(formData.get("senderName") || "").trim());
  formData.set("transferNote", String(formData.get("transferNote") || "").trim());
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
      if (pendingWhatsAppWindow) {
        pendingWhatsAppWindow.location.href = buildWhatsAppUrl(paymentInfo.sellerWhatsAppNumber, result);
      } else {
        window.location.href = buildWhatsAppUrl(paymentInfo.sellerWhatsAppNumber, result);
      }
    }

    localStorage.removeItem("cart");
    cart = [];
    checkoutForm.reset();
    syncPaymentMethodFields();
    renderCheckout();
    sessionStorage.setItem("pendingToast", `Pesanan berhasil dibuat. ID: ${result.id}`);
    window.location.href = "/";
  } catch (error) {
    if (pendingWhatsAppWindow) {
      pendingWhatsAppWindow.close();
    }
    checkoutMessage.textContent = error.message;
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

async function loadPaymentInfo() {
  paymentInfoContainer.innerHTML = "<p>Memuat info pembayaran...</p>";

  try {
    const response = await fetch("/api/payment-info");
    const info = await response.json();
    paymentInfo = info;
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
  } catch (_error) {
    paymentInfoContainer.innerHTML = "<p>Info pembayaran gagal dimuat.</p>";
  }
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
}

function getSelectedPaymentMethod() {
  return paymentMethodInputs.find((input) => input.checked)?.value || "Transfer Bank";
}

function buildWhatsAppUrl(number, order) {
  const itemLines = order.items
    .map((item) => `- ${item.name} ${item.variantLabel ? `(${item.variantLabel}) ` : ""}x${item.quantity} (${formatCurrency(item.subtotal)})`)
    .join("\n");
  const text = [
    "Halo, saya sudah membuat pesanan.",
    `ID Order: ${order.id}`,
    `Nama: ${order.customerName}`,
    `No HP: ${order.phone}`,
    `Alamat: ${order.address}`,
    "Pesanan:",
    itemLines,
    `Total: ${formatCurrency(order.total)}`
  ].join("\n");
  const normalizedNumber = String(number).replace(/[^\d]/g, "");
  return `https://api.whatsapp.com/send?phone=${normalizedNumber}&text=${encodeURIComponent(text)}`;
}

function formatWhatsAppNumber(number) {
  if (!number) {
    return "-";
  }
  return `+${String(number).replace(/[^\d]/g, "")}`;
}

function renderCheckout() {
  checkoutItems.innerHTML = "";

  if (!cart.length) {
    checkoutItems.innerHTML = "<p>Keranjang masih kosong. Tambahkan produk dari halaman toko.</p>";
    checkoutSummary.textContent = "0 item";
    checkoutTotal.textContent = formatCurrency(0);
    return;
  }

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  checkoutSummary.textContent = `${totalItems} item`;

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-row">
        <strong>${item.name}</strong>
        <span class="muted">${item.variantLabel || "Reguler"} • Qty ${item.quantity}</span>
      </div>
      <strong>${formatCurrency(item.price * item.quantity)}</strong>
    `;
    checkoutItems.appendChild(row);
  });

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  checkoutTotal.textContent = formatCurrency(total);
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

function showNotification(message, duration = 3000, redirectUrl = null) {
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
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    }, 500);
  }, duration);
}
