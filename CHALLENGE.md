## Bối cảnh

Một yêu cầu bồi thường (claim) đi qua một vòng đời xác định:

`Submitted → Documents Verified → Under Assessment → Approved/Rejected → Payment Initiated → Closed`

Mỗi lần chuyển trạng thái:
- có **điều kiện tiên quyết** (phải đúng thì mới được chuyển),
- kích hoạt **tác dụng phụ** (thông báo, ghi nhật ký kiểm toán),
- có thể yêu cầu **vai trò cụ thể** mới được phép thực hiện.

Một lần chuyển sai, ví dụ duyệt hồ sơ trước khi giấy tờ được xác minh, có thể dẫn đến gian lận hoặc vi phạm quy định.

## Vấn đề

Xây dựng một **công cụ điều phối quy trình dựa trên máy trạng thái** để quản lý các lần chuyển trạng thái trong vòng đời hồ sơ bồi thường, gồm: điều kiện tiên quyết, tác dụng phụ, phân quyền theo vai trò và nhật ký kiểm toán đầy đủ.

## Định nghĩa máy trạng thái

### Các trạng thái

| Trạng thái | Mô tả |
|---|---|
| `SUBMITTED` | Đã nhận hồ sơ, đang chờ xác minh giấy tờ |
| `DOCUMENTS_VERIFIED` | Đã xác nhận mọi giấy tờ cần thiết đều đầy đủ và hợp lệ |
| `UNDER_ASSESSMENT` | Người thẩm định đang xem xét hồ sơ |
| `PENDING_INFO` | Đã yêu cầu thành viên cung cấp thêm thông tin |
| `APPROVED` | Hồ sơ được chấp thuận để thanh toán |
| `REJECTED` | Hồ sơ bị từ chối |
| `PAYMENT_INITIATED` | Đã bắt đầu xử lý thanh toán |
| `CLOSED` | Vòng đời hồ sơ đã hoàn tất |

### Các lần chuyển trạng thái

| Từ | Đến | Điều kiện tiên quyết | Tác dụng phụ | Vai trò được phép |
|---|---|---|---|---|
| `SUBMITTED` | `DOCUMENTS_VERIFIED` | Có đủ các giấy tờ cần thiết | Thông báo cho nhóm thẩm định | `document_clerk` |
| `DOCUMENTS_VERIFIED` | `UNDER_ASSESSMENT` | Đã chỉ định người thẩm định | Ghi lại thời điểm bắt đầu thẩm định | `team_lead` |
| `UNDER_ASSESSMENT` | `APPROVED` | Báo cáo thẩm định hoàn tất và số tiền ≤ hạn mức bảo hiểm | Thông báo cho thành viên, tạo yêu cầu thanh toán | `assessor` |
| `UNDER_ASSESSMENT` | `REJECTED` | Báo cáo thẩm định hoàn tất và có lý do từ chối | Thông báo cho thành viên kèm lý do và hướng dẫn khiếu nại | `assessor` |
| `UNDER_ASSESSMENT` | `PENDING_INFO` | Có mô tả thông tin còn thiếu | Thông báo cho thành viên chi tiết yêu cầu | `assessor` |
| `PENDING_INFO` | `DOCUMENTS_VERIFIED` | Đã nhận giấy tờ hoặc thông tin mới | Đặt lại đồng hồ thẩm định | `document_clerk` |
| `APPROVED` | `PAYMENT_INITIATED` | Đã tạo yêu cầu thanh toán | Kích hoạt hệ thống thanh toán | `finance` |
| `PAYMENT_INITIATED` | `CLOSED` | Thanh toán đã được xác nhận | Thông báo cho thành viên kèm mã tham chiếu thanh toán | `finance` |
| `REJECTED` | `CLOSED` | Hết hạn khiếu nại **HOẶC** thành viên đã xác nhận | Lưu trữ hồ sơ | `system` |

## Yêu cầu

### Lõi của công cụ
- Máy trạng thái được định nghĩa trong **file cấu hình (JSON/YAML)**, không viết cứng trong logic ứng dụng.
- **Kiểm tra lần chuyển:** từ chối lần chuyển không hợp lệ, kèm lỗi **cụ thể** giải thích lý do.
- **Kiểm tra điều kiện tiên quyết** trước khi cho phép chuyển.
- **Chạy tác dụng phụ** sau khi chuyển thành công (cài đặt giả lập, chỉ ghi ra console).
- **Phân quyền theo vai trò:** từ chối lần chuyển từ vai trò không được phép.

### Nhật ký kiểm toán (audit trail)
- Mỗi lần chuyển được ghi lại với: **thời gian, trạng thái nguồn (`from_state`), trạng thái đích (`to_state`), người thực hiện (`triggered_by`: ID người dùng + vai trò), lý do/ghi chú**.
- Nhật ký **bất biến**: không thể sửa hoặc xóa mục đã ghi.
- **Truy vấn nhật ký theo ID hồ sơ** để xem toàn bộ lịch sử.

### Phát hiện chu kỳ (cycle detection)
- Vòng lặp `UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT` được phép, nhưng **tối đa 3 chu kỳ**.
- Ở lần thứ **4**, từ chối lần chuyển với đúng thông báo: **`Maximum information requests exceeded — escalate to team lead`**.

### Các kịch bản kiểm thử
Cài đặt và chạy **5 kịch bản**:

1. **Luồng thành công (happy path):** `SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED`
2. **Luồng từ chối:** `SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → CLOSED`
3. **Vòng yêu cầu thêm thông tin:** `SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED`
4. **Lần chuyển không hợp lệ:** thử `SUBMITTED → APPROVED` (phải thất bại với lỗi rõ ràng)
5. **Sai vai trò:** thử chuyển với vai trò không đúng (phải thất bại)

### Giao diện
- **CLI hoặc giao diện web** cho phép: xem trạng thái hiện tại và các lần chuyển hợp lệ, đưa hồ sơ qua các trạng thái, xem nhật ký kiểm toán của hồ sơ.
- Hiển thị các lần chuyển khả dụng từ trạng thái hiện tại, **kèm vai trò cần có**.

## Tiêu chí đánh giá

- Cả 5 kịch bản cho kết quả đúng.
- Lần chuyển không hợp lệ bị từ chối với thông báo **cụ thể** (không phải câu chung chung "invalid transition").
- Điều kiện tiên quyết được thực thi (**chứng minh bằng một trường hợp điều kiện không đạt**).
- Phân quyền theo vai trò được thực thi.
- Nhật ký kiểm toán đầy đủ và chính xác cho mọi kịch bản.
- Phát hiện chu kỳ ngăn được vòng lặp vô hạn.
- **Thêm một trạng thái hoặc lần chuyển mới chỉ cần đổi cấu hình** (minh họa bằng một bản diff).
- **Tối thiểu 15 test**, bao gồm: chuyển hợp lệ, chuyển không hợp lệ, lỗi điều kiện tiên quyết, phân quyền vai trò, phát hiện chu kỳ.

## Bài nộp

- Đẩy dự án lên một repository GitHub.
- Kèm theo: cấu hình máy trạng thái, kết quả chạy các kịch bản kiểm thử và đầu ra nhật ký kiểm toán.

## Lưu ý của Papaya cho toàn bộ bài AI (từ README của họ)

- **Nhật ký hội thoại AI gốc, chưa chỉnh sửa** là bắt buộc, thiếu là tự động trượt.
- Kèm repo, URL chạy thử (nếu đề yêu cầu) và bản ghi chú ngắn về cách làm và các quyết định.
- Ứng viên phải hiểu và bảo vệ được mọi thứ mình nộp.
