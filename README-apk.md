# Build APK — ghi chú thiết lập

## Cách hoạt động

Game vốn là PWA (Vite + JS thuần, không framework) — không có sẵn app Android.
`.github/workflows/build-apk.yml` dùng [Capacitor](https://capacitorjs.com) để đóng
gói `dist/` (kết quả `npm run build`) thành 1 APK Android thật, chạy độc lập, không
cần tải lại từ server mỗi lần mở (khác với TWA/Bubblewrap — vốn cần app luôn mở được
mạng để load 1 URL sống).

## Chạy tự động trên GitHub (không cần cài gì ở máy)

1. Push code lên nhánh `main` (hoặc vào tab **Actions** trên GitHub → chọn
   **Build APK** → **Run workflow** để chạy thủ công).
2. Đợi job chạy xong (~3-5 phút) → vào **Actions** → chọn lần chạy vừa xong → mục
   **Artifacts** ở cuối trang → tải `zombie-commander-debug-apk.zip` → giải nén ra
   được `app-debug.apk`.
3. Copy file `.apk` vào điện thoại Android, bật "Cài từ nguồn không xác định" rồi cài.

APK build ra là bản **debug**, tự ký bằng debug keystore mặc định của Android —
cài chạy bình thường trên điện thoại, chỉ không đăng lên được Google Play (Play
yêu cầu ký bằng keystore release riêng, xem mục dưới).

### (Tùy chọn) Bật Bảng Xếp Hạng / Boss TG / Đấu Trường thật trong APK

Client dùng Supabase, đọc qua `import.meta.env` lúc build — vào
**Settings → Secrets and variables → Actions** trên GitHub repo, thêm 2 Secret:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Không điền thì APK vẫn build và chạy bình thường — game tự lazy-init, chỉ 3 tính
năng online kể trên không hoạt động (xem `src/net/supabaseClient.js`), toàn bộ
phần idle/12 hệ/lưu game local vẫn chạy đầy đủ.

## Build ở máy local (cần Android Studio/SDK, JDK 17)

```bash
npm install
npm run build
npx cap add android      # chỉ chạy lần đầu — sinh thư mục android/
npx cap sync android      # chạy lại mỗi khi sửa code web
cd android
./gradlew assembleDebug   # ra file android/app/build/outputs/apk/debug/app-debug.apk
```

Hoặc mở bằng Android Studio để build/debug trực quan: `npm run cap:open`.

## Build bản release để đăng Google Play (chưa làm — cần làm khi muốn public)

Cần tự tạo keystore ký release (`keytool -genkey ...`), cấu hình trong
`android/app/build.gradle`, rồi `./gradlew assembleRelease`. Chưa động vào phần
này vì phụ thuộc thông tin định danh nhà phát triển (tên gói, chữ ký...) mà chỉ
bạn mới quyết định được — làm khi bạn thực sự sẵn sàng đăng app.
