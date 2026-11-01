# Checklist trải nghiệm hệ thống (dành cho người kiểm duyệt)

Chạy `npm run dev`, mở http://localhost:5173. Để bắt đầu sạch, xóa thư mục `data/` trước khi chạy.

Ghi chú: giao diện không có đăng nhập. Ô **Acting as (role)** ở góc trên phải là cách bạn "đóng vai" từng người. Mỗi mục dưới đây ghi rõ vai trò cần chọn.

Cột **Tự kiểm** là kết quả mình đã chạy trên trình duyệt trong phiên làm việc này; bạn hãy tự chạy lại và đánh dấu cột của bạn.

## A. Luồng thành công và phân quyền

| # | Vai trò | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|---|
| A1 | `document_clerk` | **New claim** → Submit (5000.00 / 10000.00) | Banner xanh "Submit claim — applied"; hồ sơ `CLM-0001` ở `SUBMITTED`; audit #1 `CREATE` | ✅ | ✅ |
| A2 | `document_clerk` | Gõ lý do, bấm **Move to DOCUMENTS_VERIFIED** khi chưa có giấy tờ | Banner đỏ `PRECONDITION_FAILED`, nêu rõ cần `claim_form, identity_document, supporting_evidence`; hồ sơ không đổi; audit thêm dòng `DENIED` | ✅ | ✅ |
| A3 | `document_clerk` | Ở **Claim data**, nhập `claim_form, identity_document, supporting_evidence` → Save changes | Banner xanh; mục điều kiện chuyển sang "✓ Met"; audit thêm `DATA_UPDATE` | ✅ | ✅ |
| A4 | `finance` | Bấm **Move to DOCUMENTS_VERIFIED** | Banner đỏ `ROLE_NOT_ALLOWED`: "Role 'finance' cannot move … requires one of: document_clerk"; hồ sơ không đổi | ✅ | ✅ |
| A5 | `document_clerk` | Bấm lại **Move to DOCUMENTS_VERIFIED** | Thành công, hồ sơ sang `DOCUMENTS_VERIFIED`, thanh trạng thái đánh dấu ✓ | ✅ | ✅ |
| A6 | `team_lead` | Panel **Claim data** chỉ có ô `assessorId`; nhập `assessor-01`, Save; rồi **Move to UNDER_ASSESSMENT** | Chỉ `assessorId` sửa được (vai trò khác không thấy ô này); chuyển thành công | ✅ | ✅ |
| A7 | `assessor` | Ở `UNDER_ASSESSMENT`, xem thẻ **→ APPROVED** | Hiện 4 điều kiện chưa đạt: báo cáo thẩm định, số tiền được duyệt, ≤ hạn mức, ≤ số tiền yêu cầu | ✅ (thẻ APPROVED hiện đúng 4 điều kiện) | ✅ |
| A8 | `assessor` | Đặt `assessmentReportComplete = true` và `approvedAmount = 5000.00` → **Move to APPROVED** | Thành công; `paymentRequestId` được hệ thống tạo (assessor không tự sửa được trường này) | ✅ (CLM-0016 duyệt ở 10,000.00) | ✅ |
| A9 | `finance` | **Move to PAYMENT_INITIATED**, rồi nhập `paymentConfirmed = true`, `paymentReference` → **Move to CLOSED** | Hồ sơ `CLOSED`; "This is a final state"; không còn transition | ☑ qua API, giao diện xác nhận trạng thái cuối | ✅ |

## B. Giới hạn chu kỳ

| # | Vai trò | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|---|
| B1 | `assessor` / `document_clerk` / `team_lead` | Với hồ sơ ở `UNDER_ASSESSMENT`: yêu cầu thông tin → clerk ghi nhận (`newInfoReceived = true`) → lead bắt đầu thẩm định lại, lặp 3 lần | Cả 3 vòng thành công; thẻ **PENDING_INFO** hiện "Used n of 3 allowed" | ☑ vòng chạy qua API | ✅ |
| B2 | `assessor` | Nhập `missingInfoDescription`, bấm **Move to PENDING_INFO** lần thứ 4 | Banner đỏ `MAX_COUNT_EXCEEDED`: **"Maximum information requests exceeded — escalate to team lead"**; thẻ ghi "Used 3 of 3 allowed" | ✅ | ✅ |

## C. Nhật ký kiểm toán

| # | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|
| C1 | Xem bảng **Audit trail** của hồ sơ | Mới nhất ở trên; mỗi dòng có thời gian UTC, kết quả ✓ APPLIED / ✗ DENIED, hành động, `from → to`, người thực hiện (id + vai trò), lý do | ✅ (22 dòng, 4 dòng DENIED trong lần chạy thử) | ✅ |
| C2 | Xem dòng bị từ chối | Hiện mã lỗi và thông báo cụ thể | ✅ | ✅ |
| C3 | Xem dòng cập nhật dữ liệu / chuyển trạng thái | Hiện các thay đổi dữ liệu `trường: trước → sau` và kết quả tác dụng phụ | ✅ | ✅ |
| C4 | Tải lại trang (F5) | Hồ sơ và audit còn nguyên | ✅ | ✅ |
| C5 | Mở `data/audit.jsonl`, sửa tay một ký tự, khởi động lại API | API **từ chối khởi động**: "failed integrity check at entry N" | ☑ qua test tự động | ☐ |

## D. Kiểm tra quyền sửa dữ liệu

| # | Vai trò | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|---|
| D1 | `finance` | Mở hồ sơ ở `UNDER_ASSESSMENT`, xem panel Claim data | "This role cannot edit any field in this state" | ☑ qua test API/engine | ✅ |
| D2 | Bất kỳ | Thử `PATCH /api/claims/:id/data` với `paymentRequestId` | 403 `DATA_NOT_ALLOWED` ("system-managed") | ☑ qua test API | ✅ |

## G. Các quy tắc nghiệp vụ bổ sung sau lần duyệt đầu

| # | Vai trò | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|---|
| G1 | `document_clerk` | Hồ sơ ở `PENDING_INFO`: đặt `documents` chỉ còn `hospital_invoice`, bật `newInfoReceived`, bấm chuyển về `DOCUMENTS_VERIFIED` | Bị từ chối `PRECONDITION_FAILED`: "All required documents must be present again …"; giữ đủ 3 giấy tờ bắt buộc thì chuyển được | ☑ qua API trên server đang chạy | ✅ |
| G2 | `assessor` | Hoàn tất báo cáo + số tiền được duyệt, yêu cầu thêm thông tin, clerk ghi nhận, lead bắt đầu thẩm định lại; rồi thử **Move to APPROVED** ngay | Bị từ chối: báo cáo thẩm định và số tiền được duyệt đã bị xóa, phải thẩm định lại | ☑ qua API trên server đang chạy | ✅ |
| G3 | `document_clerk` | Hồ sơ ở `UNDER_ASSESSMENT`, mở **Claim data** | Không có ô nào sửa được (clerk chỉ sửa lúc `SUBMITTED` và `PENDING_INFO`) | ☑ qua test ma trận (mọi trạng thái × vai trò × trường) | ✅ |
| G4 | `assessor` | Hồ sơ vượt hạn mức (ví dụ yêu cầu 15000.00, hạn mức 10000.00): ô `claimAmount` không sửa được; đặt `approvedAmount = 10000.00` rồi duyệt | Duyệt thành công; `claimAmount` vẫn 15,000.00, `approvedAmount` 10,000.00. Đặt `approvedAmount = 10000.01` thì bị từ chối | ✅ (ô claimAmount không sửa được; 10,000.01 bị từ chối, 10,000.00 được duyệt) | ✅ |
| G5 | `assessor` | Từ chối với `appealDeadline` là một ngày đã qua (hoặc trống) | Bị từ chối `PRECONDITION_FAILED`: "… must be set and be after the time of rejection …"; đặt ngày tương lai thì từ chối được; sau đó `system` không đóng được ngay | ☑ qua API trên server đang chạy | ✅ |

## E. Trình bày và khả năng tiếp cận

| # | Thao tác | Kết quả mong đợi | Tự kiểm | Bạn |
|---|---|---|---|---|
| E1 | Thu nhỏ cửa sổ về cỡ điện thoại (375px) | Không có thanh cuộn ngang của trang; bảng audit tự cuộn ngang trong khung riêng | ✅ | ✅ |
| E2 | Đổi vai trò nhiều lần | Mỗi panel chỉ xuất hiện đúng một bản (lỗi nhân bản đã sửa) | ✅ | ✅ |
| E3 | Bấm nút ở phần thấp của trang | Banner kết quả vẫn thấy được (dính ở đầu vùng nhìn) | ✅ | ☐ |
| E4 | Thử chế độ sáng và tối của hệ điều hành | Cả hai đều đọc được | ☑ chỉ kiểm chế độ tối | ✅ |

## F. Kiểm tra bằng lệnh

```bash
npm test             # kỳ vọng: engine 139 pass + 1 skip, API 16 pass, web 17 pass
npm run typecheck    # kỳ vọng: không lỗi
npm run scenarios    # kỳ vọng: 6 kịch bản PASS
```

Mục skip duy nhất là ca "điều kiện không đạt" của `APPROVED → PAYMENT_INITIATED`: transition này không thể thất bại do người dùng vì mã yêu cầu thanh toán do hệ thống tạo khi duyệt (có chú thích trong test).

## Những điều mình chưa kiểm được, bạn nên tự thử

- Chế độ sáng của hệ điều hành; trình duyệt ngoài Chromium; màn hình rất rộng.
- Hai tab cùng thao tác một hồ sơ cùng lúc (engine xử lý tuần tự trong một process, nhưng giao diện không tự làm mới khi tab khác thay đổi hồ sơ; dùng nút Refresh).
- Khởi động lại API giữa chừng một luồng dài (đã thử tải lại trang và khởi động lại nhiều lần trong lúc test, dữ liệu vẫn còn).
