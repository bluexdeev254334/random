# 11B7 Seat Draw

Ứng dụng web bốc thăm số ghế cho lớp 11B7. Mỗi lượt mới xáo trộn số 1-35 bằng Fisher–Yates, gán số lên 35 ghế và lưu tiến trình vào trình duyệt.

## Chạy ứng dụng

Yêu cầu Node.js 20.19+ hoặc 22.12+.

```bash
npm install
npm run dev
```

Mở URL Vite hiển thị trong terminal. Kiểm tra production bằng `npm run build`; chạy kiểm thử logic với `npm test`.

## Sử dụng

- Nhấn **QUAY** để chọn một số chưa xuất hiện. Ghế mang số đó sẽ được đánh dấu sau khi animation dừng.
- Chọn một ghế hoặc một kết quả lịch sử để làm nổi bật vị trí trên sơ đồ.
- **Hoàn tác** trả kết quả cuối cùng về danh sách còn lại.
- **Tạo lượt mới**, **Xáo trộn lại ghế** và **Xóa dữ liệu lượt bốc** đều hỏi xác nhận trước khi thay đổi tiến trình.
- Công tắc âm thanh bật/tắt tiếng báo. Tiến trình, phân bổ ghế và cài đặt âm thanh được lưu theo trình duyệt.

## Triển khai GitHub Pages

Mỗi lần đẩy lên nhánh `main`, GitHub Actions tự build và publish bản tĩnh tại:

https://bluexdeev254334.github.io/random/

Ứng dụng này là bản tĩnh: dữ liệu lượt bốc được lưu riêng trong localStorage của từng trình duyệt, không có backend hoặc database dùng chung.

## Sơ đồ và giới hạn

Workspace không có ảnh tham chiếu đi kèm, nên sơ đồ được dựng mới theo mô tả thành 5 hàng x 7 ghế, chia thành các cụm bàn theo chiều ngang; có khu vực bảng và bàn giáo viên riêng. 35 vị trí có ID cố định theo thứ tự trái sang phải, trên xuống dưới; số ngẫu nhiên trên ghế chỉ thay đổi khi xác nhận lượt mới. Dữ liệu chỉ nằm trong localStorage của trình duyệt hiện tại, không đồng bộ giữa thiết bị.