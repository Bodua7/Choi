# Web Push — ghi chú thiết lập

## Cặp khóa VAPID đã sinh sẵn (offline, dùng crypto có sẵn của Node, không qua mạng)

- **Public key** (đã điền sẵn vào `.env` là `VITE_VAPID_PUBLIC_KEY`, an toàn để lộ ra client):
  `BHt5NxGH8ymptGdFkIq68a-AwVsi0Jx9EYwykI42NWlWfHB_Srk2tIcQTWhiGqDdJfli4Cyk25XSgytV15ttpjw`
- **Private key** (⚠️ BÍ MẬT — chỉ dùng ở server/Edge Function, KHÔNG đưa vào
  `.env` của dự án client, KHÔNG commit lên Git công khai):
  `PJfVqrUKJZcZ-g4Yz8KT3OvIbed96exSbxRE6085wNU`

Nếu bạn thấy repo này sẽ public, hãy tự sinh lại 1 cặp khóa mới (vd. lệnh
`npx web-push generate-vapid-keys` khi có mạng, hoặc dùng đúng đoạn script Node
crypto đã dùng để sinh cặp trên) và thay public key trong `.env`/`.env.example`.

## Client đã làm được gì (không cần thêm gì để hoạt động)

- Nút **"Bật thông báo"** trong tab Cài Đặt: xin quyền trình duyệt, đăng ký
  `PushManager` bằng public key ở trên, lưu subscription vào bảng Supabase
  `push_subscriptions` (chạy `supabase/push.sql` trước).
- **Thông báo cục bộ** (không cần server): tự hiện khi hồi sinh Phân Thân xong,
  mở Phó Bản mới, vé Đấu Trường đầy — hoạt động ngay cả khi tab đang ẩn, nhưng
  KHÔNG hoạt động nếu app đã đóng hẳn (đây là giới hạn của trình duyệt, không
  phải lỗi code).

## Còn thiếu để push THẬT gửi được cả khi app đã đóng

Web Push đúng nghĩa cần 1 tiến trình **server** chủ động gửi tới các subscription
đã lưu — sandbox này không có mạng nên không tự deploy giúp bạn được. Đã chuẩn bị
sẵn:

1. `supabase/push.sql` — chạy trong Supabase SQL Editor để tạo bảng lưu subscription.
2. `supabase/functions/send-push/index.ts` — Edge Function mẫu (Deno, dùng thư
   viện `web-push`), gửi push tới tất cả hoặc 1 số `player_id`. Tự deploy bằng:
   ```
   supabase secrets set VAPID_PUBLIC_KEY=BHt5NxGH8ymptGdFkIq68a-AwVsi0Jx9EYwykI42NWlWfHB_Srk2tIcQTWhiGqDdJfli4Cyk25XSgytV15ttpjw
   supabase secrets set VAPID_PRIVATE_KEY=PJfVqrUKJZcZ-g4Yz8KT3OvIbed96exSbxRE6085wNU
   supabase secrets set VAPID_SUBJECT=mailto:ban@vidu.com
   supabase functions deploy send-push
   ```
3. Sau khi deploy, có thể gọi function bằng cron (Supabase Dashboard > Edge
   Functions > cron) để tự động nhắc "Tài nguyên đã đầy, quay lại thu hoạch!"
   theo lịch, hoặc gọi thủ công qua HTTP POST khi cần bắn 1 thông báo cụ thể.
