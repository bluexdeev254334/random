# 11B7 Seat Draw

Ứng dụng bốc thăm chỗ ngồi với React/Vite, Express và SQLite. Kết quả được chọn trong transaction ở backend; người dùng có session cookie, lịch sử riêng và giới hạn một lượt theo IP (hoặc theo tài khoản nếu Super Admin đổi chế độ).

## Yêu cầu

- Node.js 20.19+ hoặc 22.12+
- npm

## Chạy local

```bash
npm install
cp .env.example .env
```

Trước lần chạy đầu tiên, sửa `ADMIN_USERNAME` và đặt `ADMIN_PASSWORD` riêng, dài tối thiểu 12 ký tự. Không đưa `.env` lên Git. Khi database mới chưa có admin, server tạo Super Admin đầu tiên từ các biến này; nếu database đã có admin, thông tin đăng nhập cũ được giữ nguyên.

```bash
npm run dev
```

Mở URL Vite, thường là `http://localhost:5173`. Vite chuyển `/api` sang backend ở `http://localhost:3001`. Dashboard nằm tại `/admin`.

Các lệnh khác:

```bash
npm run build
npm test
npm start
```

`npm start` chạy backend và phục vụ `dist/` nếu đã build. Database mặc định ở `data/app.db`; có thể đổi bằng `DB_PATH`.

## Tài khoản và cấu hình

- Super Admin đầu tiên được khởi tạo từ `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` trong `.env`.
- Mật khẩu admin dùng bcrypt; session admin là cookie HttpOnly, SameSite Strict và hết hạn sau 8 giờ.
- Super Admin tạo, khóa, mở khóa và xóa các tài khoản Admin, Moderator, Viewer trong dashboard.
- Các API quản trị kiểm tra role/permission ở backend. API key dùng chung chưa được bật; không có key nào gửi xuống frontend.
- `TRUST_PROXY` chỉ nên đặt khi server nằm sau reverse proxy tin cậy; cấu hình sai có thể làm sai địa chỉ IP dùng cho giới hạn lượt.
- Khi triển khai, dùng HTTPS và secret riêng cho môi trường production.

## Dữ liệu và tính năng

SQLite lưu users, admin accounts, roles/permissions, user/admin sessions, access logs, 35 số, spin history, classroom layout, settings, blocked IPs và audit logs. Các token session được băm trước khi lưu. Không thu thập GPS hoặc địa chỉ nhà.

Người dùng nhập tên trước khi quay. Backend chọn số bằng nguồn ngẫu nhiên mật mã trong transaction SQLite `IMMEDIATE`; IP đã quay không thể nhận lượt thứ hai qua giao diện hay gọi API trực tiếp. Admin có thể mở khóa IP, reset một người hoặc reset toàn bộ số. Dashboard có lọc người dùng, lịch sử truy cập/quay, thống kê, audit log, quản trị tài khoản, cài đặt và CSV. Super Admin có thể tải bản backup SQLite trong dashboard. Cấu hình có thể đổi tên, logo nội bộ, màu, font, thông báo, giới hạn lượt, âm thanh, thời lượng vòng quay và thời hạn lưu dữ liệu.

## Sơ đồ lớp

Không có file ảnh sơ đồ tham chiếu trong workspace hoặc phần đính kèm hiện có. Ứng dụng giữ sơ đồ mặc định 21 bàn theo số lượng tổ đã nêu (Tổ 4: 5, Tổ 3: 5, Tổ 2: 6, Tổ 1: 5) nhưng không tự gán số ghế. Admin có thể chỉnh tên tổ, vị trí bàn giáo viên/cửa, thêm hoặc xóa bàn (tổng số phải là 21), di chuyển bàn, nhập đủ số 1-35, lưu phiên bản và khôi phục phiên bản đã lưu. Backend từ chối lưu nếu tổng bàn không phải 21 hoặc số ghế thiếu/trùng.

Hãy gửi ảnh sơ đồ để chốt hướng nhìn, vị trí cửa/bàn giáo viên và phân bổ số đúng thực tế. Khi chưa có ảnh, các số ghế chưa được gán và sẽ hiển thị là chưa gán. Bố cục hiện hỗ trợ đổi thứ tự bàn bằng nút lên/xuống, chưa hỗ trợ kéo thả tự do.

## Triển khai và giới hạn hiện tại

Triển khai cả Node backend và SQLite persistent volume; không thể chỉ host thư mục `dist/` trên static host. Đặt `PORT`, `DB_PATH` và các secret qua môi trường của nền tảng, chạy `npm run build`, sau đó `npm start` sau reverse proxy HTTPS.

Backup tải xuống đã có; khôi phục backup, nhật ký lỗi hệ thống riêng, quản trị API key và biểu đồ nâng cao chưa triển khai. Dữ liệu truy cập và phiên cũ hơn `history_retention_days` được dọn định kỳ mỗi ngày. Lịch sử quay được giữ đến khi Super Admin đặt lại lượt để bảo toàn số đã chọn và khóa chống quay trùng. IP là cơ chế hạn chế lượt, không phải xác thực danh tính; Super Admin có thể chuyển sang chế độ tài khoản khi nhiều người dùng chung Wi-Fi. GitHub Pages/static hosting không đủ vì ứng dụng cần Node.js và ổ đĩa lưu trữ bền vững cho SQLite; dùng nền tảng có persistent volume cho triển khai online.