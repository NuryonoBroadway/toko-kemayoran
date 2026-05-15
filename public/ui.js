// Shared UI Components (Notification & Confirm)

function showNotification(message, type = "info") {
  let container = document.getElementById("notification-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "notification-container";
    container.className = "notification-container";
    document.body.appendChild(container);
  }

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <span>${message}</span>
    <button class="notif-close">&times;</button>
  `;

  container.appendChild(notification);

  const close = () => {
    notification.classList.add("fade-out");
    setTimeout(() => notification.remove(), 2000);
  };

  notification.querySelector(".notif-close").onclick = close;
  setTimeout(close, 2000);
}

function showConfirm(message, onConfirm, onCancel) {
  let modal = document.getElementById("confirm-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "confirm-modal";
    modal.className = "modal-overlay hidden";
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 400px; text-align: center;">
        <div class="modal-header" style="justify-content: center; border-bottom: none; padding-bottom: 0;">
          <h2 style="font-size: 20px;">Konfirmasi</h2>
        </div>
        <div class="modal-body" style="padding: 20px 0;">
          <p id="confirm-message" style="font-size: 15px; color: var(--text-muted);"></p>
        </div>
        <div class="modal-footer" style="display: flex; gap: 12px; border-top: none; padding: 0;">
          <button id="confirm-cancel-btn" class="secondary-button" style="flex: 1;">Batal</button>
          <button id="confirm-ok-btn" class="primary-button" style="flex: 1;">Ya, Hapus</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const messageEl = modal.querySelector("#confirm-message");
  const okBtn = modal.querySelector("#confirm-ok-btn");
  const cancelBtn = modal.querySelector("#confirm-cancel-btn");

  messageEl.textContent = message;
  modal.classList.remove("hidden");

  const cleanup = () => {
    modal.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };

  okBtn.onclick = () => {
    cleanup();
    if (onConfirm) onConfirm();
  };

  cancelBtn.onclick = () => {
    cleanup();
    if (onCancel) onCancel();
  };

  modal.onclick = (e) => {
    if (e.target === modal) cleanup();
  };
}
