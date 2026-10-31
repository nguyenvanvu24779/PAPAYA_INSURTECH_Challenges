# PLAN — Claim Workflow Orchestrator

> Trạng thái: **DRAFT chờ duyệt**. Chưa có code nào được viết.
> Deadline nộp: **12:00, 01/11/2026**. Quỹ thời gian: ~5 giờ (tối 31/10 + sáng 01/11).
> Mục tiêu nộp sớm: **trước 11:00, 01/11** (chừa 1 giờ dự phòng).

---

## 1. Mục tiêu và phạm vi

Xây công cụ điều phối vòng đời claim bảo hiểm theo máy trạng thái **định nghĩa bằng config**, gồm: kiểm tra chuyển, điều kiện tiên quyết, tác dụng phụ (mock), phân quyền vai trò, audit trail bất biến, giới hạn chu kỳ yêu cầu thêm thông tin, giao diện web, 5 kịch bản, tối thiểu 15 test.

### Trong phạm vi
- Engine + config YAML, API Express, web UI (Vite + Tailwind), 5 kịch bản, test, tài liệu.

### Ngoài phạm vi (cố ý bỏ)
- DB thật, ORM, auth thật, Docker, deploy, i18n, phân trang, realtime.

---

## 2. Tech stack (đã chốt)

| Lớp | Lựa chọn |
|---|---|
| Monorepo | npm workspaces: `packages/engine`, `apps/api`, `apps/web` |
| Ngôn ngữ | TypeScript (strict) toàn bộ |
| Engine | TS thuần, không phụ thuộc framework |
| Config | YAML (`yaml`) + validate bằng `zod` |
| API | Node 20+, **Express 5**, `cors`, `zod` |
| Test | Vitest, `supertest` cho API |
| Web | Vite + React + TypeScript + Tailwind CSS |
| Lưu trữ | Repository in-memory; audit ghi nối vào file JSONL |
| Dev | `tsx`, `concurrently` |

---

## 3. Cấu trúc thư mục

```
config/claim-workflow.yaml
packages/engine/
  src/config/        loader, zod schema, kiểm tra nhất quán
  src/core/          pipeline chuyển trạng thái, lỗi có mã
  src/conditions/    registry điều kiện
  src/effects/       registry tác dụng phụ (console)
  src/ports/         ClaimRepository, AuditLog, Clock
  src/adapters/      InMemoryClaimRepo, FileAuditLog, SystemClock
  test/
apps/api/
  src/app.ts  src/server.ts  src/routes/  src/middleware/
  test/
apps/web/            Vite + React + Tailwind
scripts/run-scenarios.ts
docs/                notes, scenario-output, audit-output, config-diff, transcript
PLAN.md  CHALLENGE.md  README.md
```

Chiều phụ thuộc: `web → api → engine`. Engine không biết HTTP hay file; mọi I/O đi qua ports.

---

## 4. Thiết kế chi tiết

### 4.1 Config (`config/claim-workflow.yaml`)
Mỗi transition: `from`, `to`, `roles[]`, `preconditions[]`, `effects[]`, tuỳ chọn `maxCount` + `limitMessage`.
Có phần `states` (id + mô tả) và `initialState`. Config được validate khi nạp: trạng thái tham chiếu phải tồn tại, vai trò không rỗng, tên điều kiện/tác dụng phụ phải có trong registry, không có transition trùng.

### 4.2 Pipeline chuyển trạng thái (thứ tự cố định)

| Bước | Kiểm tra | Mã lỗi |
|---|---|---|
| 1 | Transition `from → to` có tồn tại? | `TRANSITION_NOT_DEFINED` (liệt kê các lần chuyển hợp lệ) |
| 2 | Vai trò được phép? | `ROLE_NOT_ALLOWED` (nêu vai trò cần có) |
| 3 | Vượt `maxCount`? | `MAX_COUNT_EXCEEDED` (đúng câu: `Maximum information requests exceeded — escalate to team lead`) |
| 4 | Điều kiện tiên quyết đạt? | `PRECONDITION_FAILED` (nêu điều kiện nào, vì sao) |
| 5 | Đổi trạng thái → chạy tác dụng phụ → ghi audit | — |

### 4.3 Điều kiện tiên quyết (registry khai báo, không `eval`)
Toán tử: `exists`, `nonEmpty`, `isTrue`, `lte` (so hai trường), `any`, `all`.
`REJECTED → CLOSED` dùng `any(appealDeadlinePassed, memberAcknowledged)`.

### 4.4 Dữ liệu claim
`documents[]`, `assessorId`, `assessmentReportComplete`, `claimAmount`, `coverageLimit`, `rejectionReason`, `missingInfoDescription`, `newInfoReceived`, `paymentRequestId`, `paymentConfirmed`, `paymentReference`, `appealDeadline`, `memberAcknowledged`.
`data` gửi kèm lệnh chuyển được gộp vào claim **trước khi kiểm tra điều kiện**, chỉ lưu nếu chuyển thành công.

### 4.5 Tác dụng phụ (mock, ghi console)
`notify(target)`, `recordAssessmentStart`, `createPaymentRequest` (ghi `paymentRequestId` vào claim), `triggerPayment`, `resetAssessmentClock`, `archiveClaim`.
Lỗi tác dụng phụ **không rollback** trạng thái, được ghi vào audit.

### 4.6 Audit trail
Entry: `id`, `timestamp`, `claimId`, `fromState`, `toState`, `triggeredBy {userId, role}`, `reason`, `outcome` (`APPLIED` | `DENIED` + `errorCode`).
Bất biến: object frozen; interface `AuditLog` chỉ có `append` và `query(claimId)`; file JSONL chỉ ghi nối. Hash chain: tuỳ chọn, chỉ làm nếu còn thời gian.

### 4.7 Chu kỳ
Đếm số lần `UNDER_ASSESSMENT → PENDING_INFO` đã `APPLIED` của claim. Lần thứ 4 bị chặn ngay tại bước đó. Giới hạn nằm trong config (`maxCount: 3`). Claim đứng ở `UNDER_ASSESSMENT` chờ team lead (ghi rõ trong tài liệu: đề không định nghĩa luồng leo thang tiếp theo).

### 4.8 Thời gian
`Clock` là port, test dùng clock giả để kiểm tra hạn khiếu nại.

### 4.9 API

| Endpoint | Việc |
|---|---|
| `GET /api/workflow` | Định nghĩa workflow |
| `POST /api/claims`, `GET /api/claims`, `GET /api/claims/:id` | Tạo, danh sách, chi tiết |
| `PATCH /api/claims/:id/data` | Cập nhật dữ liệu claim |
| `GET /api/claims/:id/transitions` | Lần chuyển khả dụng + vai trò cần có + trạng thái điều kiện |
| `POST /api/claims/:id/transition` | `to`, `actor{userId,role}`, `reason`, `data?` |
| `GET /api/claims/:id/audit` | Nhật ký claim |

Lỗi nghiệp vụ: `{code, message}`, HTTP 4xx; lỗi lạ: 500. Một error handler duy nhất. Không auth; vai trò do UI gửi.

### 4.10 Web (một trang, 4 vùng)
1. Chọn/tạo claim + chọn user và vai trò đang đóng.
2. Trạng thái hiện tại + các lần chuyển khả dụng kèm vai trò cần có.
3. Nút chuyển + form chỉnh dữ liệu + hiển thị lỗi cụ thể từ server.
4. Bảng audit trail.
Ưu tiên thấp: nút chạy nhanh 5 kịch bản.

---

## 5. Kế hoạch kiểm thử

**Tối thiểu 15 test, mục tiêu ~20.**

| Nhóm | Ví dụ |
|---|---|
| Chuyển hợp lệ | Từng lần chuyển trong bảng đề đi đúng |
| Chuyển không hợp lệ | `SUBMITTED → APPROVED` lỗi cụ thể; chuyển từ trạng thái cuối |
| Điều kiện không đạt | Thiếu giấy tờ; chưa gán assessor; số tiền > hạn mức; thiếu lý do từ chối |
| Phân quyền | `assessor` cố xác minh giấy tờ; `finance` cố duyệt |
| Chu kỳ | 3 vòng được phép; lần 4 bị chặn đúng câu thông báo |
| Audit | Đủ trường; ghi cả `DENIED`; không sửa/xoá được; truy vấn theo claim |
| Config | Config sai (trạng thái không tồn tại) bị từ chối khi nạp |
| API | Luồng chính, định dạng lỗi, validate body |
| 5 kịch bản | Happy / Reject / Info loop / Invalid / Wrong role |

---

## 6. Tiêu chí hoàn thành (map với đề)

- [ ] 5 kịch bản cho kết quả đúng
- [ ] Lỗi chuyển không hợp lệ cụ thể, không chung chung
- [ ] Có ít nhất một ca điều kiện tiên quyết không đạt, được chứng minh
- [ ] Phân quyền vai trò được thực thi
- [ ] Audit đầy đủ, chính xác cho mọi kịch bản
- [ ] Chu kỳ chặn được vòng lặp vô hạn
- [ ] Thêm trạng thái/transition mới chỉ đổi config (có bản diff trong `docs/`)
- [ ] ≥ 15 test, đều xanh
- [ ] Repo GitHub + config + output kịch bản + output audit
- [ ] Ghi chú cách làm và quyết định
- [ ] **Nhật ký hội thoại AI gốc, chưa chỉnh sửa** (thiếu là tự động trượt)

---

## 7. Lịch thực hiện

| Giai đoạn | Thời lượng | Nội dung |
|---|---|---|
| P0 | 0:30 | Scaffold monorepo, schema, `claim-workflow.yaml` |
| P1 | 1:15 | Engine: loader, pipeline, registry |
| P2 | 0:30 | Audit, giới hạn chu kỳ |
| P3 | 0:45 | Test + runner 5 kịch bản |
| P4 | 0:30 | API Express |
| P5 | 1:00 | Web UI |
| P6 | 0:30 | README, ghi chú quyết định, diff mở rộng, export transcript, push |

**Tối nay:** P0 → P3. **Sáng mai:** P4 → P6.
**Thứ tự cắt khi trễ:** nút demo kịch bản trên UI → hash chain → làm đẹp UI. Engine, test, audit không cắt.

Mỗi giai đoạn kết thúc bằng một commit riêng để dễ review.

---

## 8. Quyết định thiết kế cần bạn duyệt

| # | Quyết định | Lý do | Rủi ro / đánh đổi |
|---|---|---|---|
| D1 | Ghi cả lần bị từ chối vào audit (`outcome: DENIED`) | Chứng minh được kịch bản 4, 5; có dấu vết nỗ lực trái phép | Đề chỉ nói "mỗi lần chuyển"; người chấm có thể chỉ mong entry thành công |
| D2 | Đếm chu kỳ tại lần `UNDER_ASSESSMENT → PENDING_INFO` thứ 4 | Khớp "lần thứ 4 từ chối" | Có thể hiểu khác ở bước `PENDING_INFO → DOCUMENTS_VERIFIED` |
| D3 | **Đã chốt (người dùng):** không auth; vai trò chọn trên UI và gửi trong request | Mục tiêu là core logic chuẩn; đề không yêu cầu auth | Không phản ánh thực tế sản xuất: ai cũng tự nhận được vai trò. Engine vẫn cưỡng chế phân quyền theo vai trò của actor; việc xác thực danh tính nằm ngoài phạm vi và được ghi rõ trong README |
| D4 | Điều kiện khai báo, không `eval` | An toàn, dễ diff, dễ giải thích | Điều kiện phức tạp phải thêm toán tử mới trong code |
| D5 | Lỗi tác dụng phụ không rollback | Tác dụng phụ là mock, tránh trạng thái nửa vời | Cần ghi rõ trong tài liệu |
| D6 | In-memory + JSONL, không DB | Đủ cho demo, ít thời gian | Không scale, không đồng thời nhiều process |
| D7 | `data` gộp vào claim trước khi kiểm tra điều kiện, chỉ lưu nếu thành công | Chuyển nguyên tử, không để dữ liệu rác | Phải xử lý rollback dữ liệu khi chuyển thất bại |

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Hết giờ trước khi xong UI | Hoàn thành engine + test trước; UI làm tối giản |
| Hiểu sai ngữ nghĩa chu kỳ | Ghi rõ quyết định D2 trong tài liệu, test bằng đúng câu thông báo |
| Quên transcript | Export transcript phiên làm việc vào `docs/` ở P6, kiểm tra lại trước khi nộp |
| Không giải thích được code | Mỗi quyết định có lý do trong mục 8; đọc lại trước khi nộp |

---

## 10. Nguyên tắc chất lượng core logic (bảo hiểm / tài chính)

1. **Fail-closed:** bất kỳ điều gì không khớp rõ ràng (transition không có, vai trò lạ, trường dữ liệu thiếu hoặc sai kiểu) đều bị từ chối, không bao giờ cho qua.
2. **Kiểm tra actor ở biên engine:** `userId` không rỗng, `role` phải là vai trò có trong config. Engine không tin dữ liệu đầu vào.
3. **Tiền không dùng số thực dấu phẩy động:** `claimAmount`, `coverageLimit` lưu bằng số nguyên theo đơn vị nhỏ nhất; từ chối giá trị âm, không phải số nguyên, `NaN`.
4. **Nguyên tử:** nếu một bước của pipeline lỗi thì không có thay đổi nửa vời ở trạng thái lẫn dữ liệu claim.
5. **Audit không bỏ sót:** cả lần `APPLIED` và `DENIED` đều được ghi; thời gian lưu UTC, định dạng ISO 8601.
6. **Không tự quyết điều đề chưa nói rõ:** mọi chỗ mơ hồ nằm ở mục 8 để người dùng duyệt.
7. **Test theo bảng của đề:** mỗi dòng trong bảng 9 lần chuyển có test riêng cho ba nhánh (chạy đúng, sai vai trò, điều kiện không đạt).
8. **Test ca biên:** số tiền đúng bằng hạn mức; hạn khiếu nại đúng bằng thời điểm hiện tại; chu kỳ lần 3 và lần 4; chuyển từ trạng thái cuối `CLOSED`; actor hoặc dữ liệu không hợp lệ.

## 11. Quy trình nhật ký hội thoại AI (bắt buộc, thiếu là trượt)

1. Dùng công cụ xuất transcript của ứng dụng, lưu **nguyên bản** vào `docs/`. Không viết tay, không tóm tắt, không cắt, không chỉnh sửa.
2. Làm toàn bộ trong **cùng một phiên**; nếu có phiên khác thì xuất và nộp đủ từng phiên.
3. **Xuất thử ngay sau khi duyệt plan** để người dùng mở xem đã đủ chưa; nếu thiếu thì còn thời gian xử lý.
4. Xuất bản cuối ngay trước khi nộp, và xuất lại nếu còn trao đổi thêm sau đó.
5. Giới hạn đã báo: nội dung bản xuất phụ thuộc công cụ của ứng dụng; kiểm tra lại sau khi xuất.
