# PLAN — Claim Workflow Orchestrator

> Trạng thái (cập nhật tối 31/10/2026): **đã duyệt và đã thực hiện xong P0–P5; P6 còn push và xuất transcript bản cuối.** Đang chờ chủ dự án review cuối.
> Hạn nộp: **12:00, 01/11/2026**. Mục tiêu nộp sớm: **trước 11:00, 01/11** (chừa 1 giờ dự phòng).
> Tài liệu liên quan: [README.md](README.md) · [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md) (quyết định D1–D20) · [docs/OPERATOR-CHECKLIST.md](docs/OPERATOR-CHECKLIST.md)

Ký hiệu: ✅ xong · ⚠️ xong một phần · ❌ chưa làm.

---

## 1. Mục tiêu và phạm vi

Xây công cụ điều phối vòng đời claim bảo hiểm theo máy trạng thái **định nghĩa bằng config**, gồm: kiểm tra chuyển, điều kiện tiên quyết, tác dụng phụ (mock), phân quyền vai trò, audit trail bất biến, giới hạn chu kỳ yêu cầu thông tin, giao diện web, 5 kịch bản, tối thiểu 15 test.

**Trong phạm vi:** engine + config YAML, API Express, web UI (Vite + Tailwind), kịch bản, test, tài liệu.
**Ngoài phạm vi (cố ý bỏ):** DB thật, ORM, xác thực người dùng, Docker, triển khai trực tuyến, i18n, phân trang, realtime.

---

## 2. Tech stack (đã chốt, đúng như thực hiện)

| Lớp | Lựa chọn |
|---|---|
| Monorepo | npm workspaces: `packages/engine`, `apps/api`, `apps/web` |
| Ngôn ngữ | TypeScript (strict) toàn bộ |
| Engine | TS thuần, không phụ thuộc framework |
| Config | YAML (`yaml`) + validate bằng `zod` 4 |
| API | Node 20+, **Express 5**, `cors`, `zod` |
| Test | Vitest 5, `supertest` cho API |
| Web | Vite 8 + React 19 + TypeScript + Tailwind CSS 4 |
| Lưu trữ | `claims.json` (ghi nguyên tử qua file tạm) + `audit.jsonl` (chỉ ghi nối, **hash chain**) trong `data/` |
| Dev | `tsx`, `concurrently` |

---

## 3. Cấu trúc thư mục (as-built)

```
config/claim-workflow.yaml          nguồn sự thật duy nhất của máy trạng thái
packages/engine/
  src/config/        schema (zod), kiểm tra chéo, loader
  src/core/          pipeline chuyển trạng thái (engine.ts), lỗi
  src/conditions/    đánh giá điều kiện (khai báo)
  src/effects/       lập kế hoạch tác dụng phụ (mock)
  src/ports/         ClaimRepository, AuditLog, Clock
  src/adapters/      audit log (hash chain, JSONL), kho claim, đồng hồ
  scenarios/         bộ kịch bản + harness dùng chung cho test và runner
  test/
apps/api/            Express 5 (src/app.ts, src/server.ts) + test
apps/web/            Vite + React + Tailwind
scripts/run-scenarios.ts
docs/                scenario-output, audit-output, config-extension.diff, examples/, DESIGN-NOTES, OPERATOR-CHECKLIST
PLAN.md  CHALLENGE.md  README.md
```

Chiều phụ thuộc: `web → api → engine`. Engine không biết HTTP hay file; mọi I/O đi qua ports.

---

## 4. Thiết kế (as-built; chi tiết và lý do ở DESIGN-NOTES)

**Config.** Mỗi transition: `from`, `to`, `roles[]`, `preconditions[]`, `effects[]`, tuỳ chọn `maxCount` + `limitMessage`. Ngoài ra có `intake` (vai trò được tạo claim) và `dataAccess` (ai được sửa trường nào, ở trạng thái nào). Config được kiểm tra khi nạp: trạng thái/vai trò/trường tham chiếu phải tồn tại và đúng kiểu, không trùng transition, không có trạng thái không tới được hoặc ngõ cụt, placeholder trong thông báo phải là trường hợp lệ.

**Pipeline chuyển trạng thái** (dừng và ghi audit `DENIED` ở cổng đầu tiên không đạt):

| Bước | Kiểm tra | Mã lỗi |
|---|---|---|
| 0 | Có lý do/ghi chú; vai trò có trong config | `INVALID_REASON`, `UNKNOWN_ROLE` |
| 1 | Trạng thái đích tồn tại; transition `from → to` có định nghĩa | `UNKNOWN_STATE`, `TRANSITION_NOT_DEFINED` (liệt kê đích hợp lệ) |
| 2 | Vai trò được phép cho transition | `ROLE_NOT_ALLOWED` (nêu vai trò cần có) |
| 3 | Dữ liệu gửi kèm hợp lệ và vai trò được sửa trường đó ở trạng thái này | `INVALID_DATA`, `DATA_NOT_ALLOWED` |
| 4 | Giới hạn chu kỳ `maxCount` | `MAX_COUNT_EXCEEDED` (đúng câu: `Maximum information requests exceeded — escalate to team lead`) |
| 5 | Điều kiện tiên quyết (báo đủ mọi điều kiện chưa đạt) | `PRECONDITION_FAILED` |
| 6 | Commit nguyên tử (lưu claim, ghi audit; lỗi audit thì hoàn tác) → rồi mới phát tác dụng phụ | — |

**Điều kiện** (khai báo, không `eval`): `exists`, `nonEmpty`, `isTrue`, `isPast`, `isFuture`, `includesAll`, `lte`, `any`, `all`.
**Tác dụng phụ** (mock, ghi console): `notify`, `stampTime`, `clearFields`, `createPaymentRequest`, `triggerPayment`, `archiveClaim`. Lỗi tác dụng phụ không rollback chuyển trạng thái, được ghi vào audit.
**Audit:** `id`, `seq`, `timestamp`, `kind` (`CREATE` / `TRANSITION` / `DATA_UPDATE`), `claimId`, `fromState`, `toState`, `triggeredBy {userId, role}`, `reason`, `outcome` (`APPLIED` / `DENIED`), `errorCode`, `errorMessage`, `dataChanges` (trước/sau), `effects`, `prevHash`, `hash`. Object frozen, chỉ có `append` và `query`, file khởi động lại sẽ kiểm tra chuỗi băm.
**Chu kỳ:** đếm các lần `UNDER_ASSESSMENT → PENDING_INFO` đã `APPLIED` (lấy từ audit); lần thứ 4 bị chặn.
**API:** `GET /api/workflow`, `GET|POST /api/claims`, `GET /api/claims/:id`, `PATCH /api/claims/:id/data`, `GET /api/claims/:id/transitions`, `POST /api/claims/:id/transition`, `GET /api/claims/:id/audit`, `GET /api/health`. Lỗi nghiệp vụ `{error:{code,message,details}}` (400/403/409/404), lỗi lạ 500 không lộ chi tiết. **Không xác thực** (quyết định D3): vai trò do giao diện gửi lên.
**Web:** một trang: chọn vai trò đang đóng, danh sách claim, thanh trạng thái, các transition khả dụng kèm vai trò và trạng thái điều kiện, form sửa dữ liệu theo quyền, bảng audit, banner kết quả dính khi cuộn.

---

## 5. Kiểm thử (kết quả thực tế)

**172 test pass, 1 bỏ qua có chủ đích** (engine 139, API 16, web 17). Yêu cầu của đề: tối thiểu 15.

| Nhóm | Trạng thái |
|---|---|
| Chuyển hợp lệ, từng dòng trong bảng 9 lần chuyển | ✅ |
| Chuyển không hợp lệ (từ trạng thái cuối, đích lạ, vai trò lạ, thiếu lý do) | ✅ |
| Điều kiện không đạt (mỗi dòng bảng, trừ một dòng không thể thất bại do người dùng) | ✅ |
| Phân quyền vai trò (mỗi dòng bảng) | ✅ |
| Chu kỳ (3 vòng, lần 4, theo từng claim, dữ liệu cũ bị xóa) | ✅ |
| Audit (đủ trường, ghi `DENIED`, bất biến, chuỗi băm, can thiệp file, nguyên tử) | ✅ |
| Config (config sai bị từ chối khi nạp, mở rộng chỉ bằng config) | ✅ |
| Quy tắc nghiệp vụ sau review (D17–D20), ma trận trạng thái × vai trò × trường | ✅ |
| API (luồng chính, định dạng lỗi, validate body, lỗi 500 không lộ chi tiết) | ✅ |
| Kịch bản: Happy, Reject, Info loop, Invalid, Wrong role (+ Cycle guard) | ✅ |

Các test quan trọng đã được kiểm bằng **mutation** (cố ý phá logic, xác nhận test đỏ). Giao diện được vận hành thử trong trình duyệt thật; kết quả ở OPERATOR-CHECKLIST.

---

## 6. Tiêu chí hoàn thành (map với đề)

- [x] 5 kịch bản cho kết quả đúng (`npm run scenarios`, [docs/scenario-output.txt](docs/scenario-output.txt))
- [x] Lỗi chuyển không hợp lệ cụ thể, không chung chung
- [x] Có ca điều kiện tiên quyết không đạt, được chứng minh (kịch bản 2 và nhiều test)
- [x] Phân quyền vai trò được thực thi
- [x] Audit đầy đủ, chính xác cho mọi kịch bản ([docs/audit-output.json](docs/audit-output.json))
- [x] Chu kỳ chặn được vòng lặp vô hạn
- [x] Thêm trạng thái/transition mới chỉ đổi config ([docs/config-extension.diff](docs/config-extension.diff), có test)
- [x] ≥ 15 test, đều xanh (172)
- [ ] **Repo GitHub**: code đã commit cục bộ nhưng **chưa push** (ahead `origin/main`)
- [x] Ghi chú cách làm và quyết định ([docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md))
- [ ] **Nhật ký hội thoại AI gốc, chưa chỉnh sửa**: mới xuất thử ra thư mục Downloads, **chưa nằm trong repo** (thiếu là tự động trượt)

---

## 7. Lịch thực hiện và trạng thái

| Giai đoạn | Kế hoạch | Nội dung | Trạng thái |
|---|---|---|---|
| P0 | 0:30 | Scaffold monorepo, schema, `claim-workflow.yaml` | ✅ |
| P1 | 1:15 | Engine: loader, pipeline, điều kiện, tác dụng phụ | ✅ |
| P2 | 0:30 | Audit, giới hạn chu kỳ | ✅ (kèm hash chain) |
| P3 | 0:45 | Test + runner kịch bản | ✅ |
| P4 | 0:30 | API Express | ✅ |
| P5 | 1:00 | Web UI | ✅ (không làm nút chạy nhanh kịch bản trên UI, đã dự kiến là có thể cắt) |
| P6 | 0:30 | README, ghi chú, diff mở rộng, transcript, push | ⚠️ tài liệu xong; còn transcript bản cuối và push |
| Review | — | Chủ dự án review, 5 sửa đổi nghiệp vụ (D17–D20, D11) | ✅ sửa xong; đang review tiếp |

Mỗi giai đoạn có commit riêng (xem `git log`).

---

## 8. Quyết định thiết kế

Danh sách đầy đủ (D1–D20) với lý do và đánh đổi nằm ở [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md). Tình trạng duyệt:

| Quyết định | Tình trạng |
|---|---|
| D1 audit ghi cả lần bị từ chối · D2 cách đếm chu kỳ · D3 không xác thực | **Chủ dự án đã duyệt/chốt** |
| D18 `approvedAmount ≤ claimAmount` · D19 clerk sửa thêm ở `PENDING_INFO` | **Chủ dự án đã xác nhận** |
| D17, D20, D11 (kiểm đủ giấy tờ khi quay lại, hạn khiếu nại ở tương lai, xóa kết quả thẩm định cũ) | Theo đúng yêu cầu của chủ dự án |
| D8 quyền sửa từng trường (`dataAccess`) | Mình đề xuất và triển khai; chủ dự án đã dùng và góp ý chỉnh, **chưa xác nhận rõ** |
| D12 danh sách giấy tờ bắt buộc · D14 dữ liệu hạn khiếu nại | Giả định; **chưa xác nhận rõ** |
| D16 trạng thái `ESCALATED` | Chỉ là ví dụ mở rộng, **chưa đưa vào config chính** |

---

## 9. Rủi ro

| Rủi ro | Trạng thái |
|---|---|
| Hết giờ trước khi xong UI | Đã qua: UI xong, còn dư thời gian |
| Hiểu sai ngữ nghĩa chu kỳ | Đã giảm: D2 được duyệt, test bằng đúng câu thông báo |
| **Quên transcript** | **Còn mở:** phải xuất bản cuối vào `docs/ai-conversation-log/` rồi kiểm tra |
| **Quên push** | **Còn mở:** repo GitHub hiện chưa có bài làm |
| Không giải thích được code | Mỗi quyết định có lý do ở DESIGN-NOTES; chủ dự án đọc lại trước khi nộp |
| Lỗi chỉ thấy khi dùng giao diện thật | Đã xảy ra và đã sửa (key trùng, xung đột `PORT`, banner khuất, lý do cũ); xem DESIGN-NOTES |
| Chưa kiểm: chế độ sáng, trình duyệt ngoài Chromium, hai tab cùng thao tác | Còn mở, ghi ở cuối OPERATOR-CHECKLIST |

---

## 10. Nguyên tắc chất lượng core logic (bảo hiểm / tài chính)

Tất cả đã được thực hiện.

1. **Fail-closed:** không khớp rõ ràng thì từ chối.
2. **Kiểm tra actor ở biên engine:** `userId` không rỗng, `role` phải có trong config.
3. **Tiền là số nguyên đơn vị nhỏ nhất**, từ chối số âm, số thập phân, `NaN`, số quá lớn.
4. **Nguyên tử:** lỗi ghi audit thì claim được hoàn tác và không phát tác dụng phụ.
5. **Audit không bỏ sót:** ghi cả `APPLIED` và `DENIED`; thời gian UTC, ISO 8601.
6. **Không tự quyết điều đề chưa nói rõ:** mọi giả định được ghi lại ở DESIGN-NOTES.
7. **Test theo bảng của đề:** mỗi dòng có test cho ba nhánh.
8. **Test ca biên:** số tiền bằng hạn mức, hạn khiếu nại đúng thời điểm hiện tại (chính xác đến mili-giây), chu kỳ lần 3/4, trạng thái cuối, dữ liệu không hợp lệ.

---

## 11. Quy trình nhật ký hội thoại AI (bắt buộc, thiếu là trượt)

1. Dùng công cụ xuất transcript của ứng dụng, lưu **nguyên bản** vào `docs/ai-conversation-log/`. Không viết tay, tóm tắt, cắt hay chỉnh sửa. ❌ chưa có trong repo
2. Làm toàn bộ trong **cùng một phiên** (đã tuân thủ cho tới nay).
3. Xuất thử sau khi duyệt plan để chủ dự án kiểm tra. ✅ đã xuất thử ra Downloads; chủ dự án cần mở xem đã đủ ngữ cảnh chưa.
4. **Xuất bản cuối ngay trước khi nộp**, và xuất lại nếu còn trao đổi thêm. ❌
5. Giới hạn đã báo: nội dung bản xuất phụ thuộc công cụ của ứng dụng; kiểm tra lại sau khi xuất.

---

## 12. Khác biệt so với plan ban đầu

| Plan ban đầu | Thực tế | Lý do |
|---|---|---|
| Bốn bước pipeline (định nghĩa → vai trò → chu kỳ → điều kiện) | Thêm lý do, vai trò hợp lệ, dữ liệu hợp lệ, quyền sửa dữ liệu | Bảo vệ tính toàn vẹn (D8) |
| `claims` lưu in-memory | Lưu `claims.json` | Tránh va chạm mã claim với audit còn lại sau khi khởi động lại |
| Hash chain là tuỳ chọn | Đã làm | Còn thời gian; tăng độ tin cậy của audit |
| Tác dụng phụ chạy "sau khi chuyển" | Lập kế hoạch trước, phát ra sau khi commit thành công | Không có tác dụng phụ nào khi chuyển bị hoàn tác (D5) |
| Điều kiện `exists/nonEmpty/isTrue/lte/any/all` | Thêm `isPast`, `isFuture`, `includesAll` | Hạn khiếu nại, danh sách giấy tờ |
| Dữ liệu: `claimAmount` do nhiều vai trò sửa | `claimAmount` cố định lúc tiếp nhận, thêm `approvedAmount` | Phản hồi của chủ dự án (D18) |
| Không có | Ví dụ mở rộng `ESCALATED` | Chứng minh "chỉ đổi config" và giải ngõ cụt của giới hạn chu kỳ (D16) |
| Nút chạy 5 kịch bản trên UI | Không làm | Ưu tiên thấp, đã dự kiến cắt |

---

## 13. Việc còn lại để nộp

1. Chủ dự án review theo OPERATOR-CHECKLIST (đặc biệt mục G) và báo điểm cần sửa. **Đang chờ.**
2. Sửa các điểm được nêu, kèm test.
3. Chạy lại `npm test`, `npm run typecheck`, `npm run scenarios`.
4. Xuất transcript bản cuối vào `docs/ai-conversation-log/` (nguyên bản), chủ dự án kiểm tra.
5. Commit, **push lên `origin/main`** (cần chủ dự án đồng ý).
6. Clone repo từ GitHub vào thư mục sạch, chạy `npm install` và `npm test` để chắc người chấm cũng chạy được.
7. Kiểm tra lại toàn bộ danh sách ở mục 6: tất cả phải được đánh dấu.
