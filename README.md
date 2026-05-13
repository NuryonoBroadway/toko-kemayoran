# Toko Kemayoran

Web toko sederhana dengan:

- halaman toko untuk user biasa
- halaman admin untuk upload dan hapus produk
- halaman checkout internal untuk kirim pesanan
- admin bisa melihat daftar checkout user
- fitur keranjang berbasis `localStorage`
- backend Express dengan upload gambar via `multer`

## Menjalankan

```bash
npm install
npm run dev
```

App akan tersedia di:

- `http://localhost:3000/`
- `http://localhost:3000/admin.html`

Catatan:

- tombol admin tidak ditampilkan di halaman toko
- halaman admin tetap bisa diakses langsung lewat URL

## Konfigurasi environment

Project ini membaca konfigurasi dari `.env`.

Contoh:

```env
PORT=3000
ADMIN_TOKEN=admin123
BANK_NAME=BCA
BANK_ACCOUNT_NUMBER=1234567890
BANK_ACCOUNT_HOLDER=Toko Kemayoran
SELLER_WHATSAPP_NUMBER=6281234567890
```

Template tersedia di `.env.example`.

## Token admin default

Secara default token admin adalah:

```txt
admin123
```
