# Báo cáo bài làm: Claim Workflow Orchestrator

Bài làm cho đề trong [CHALLENGE.md](CHALLENGE.md): công cụ điều phối vòng đời claim bảo hiểm bằng máy trạng thái định nghĩa trong cấu hình.

## 1. Kết quả

| Hạng mục | Kết quả |
|---|---|
| Máy trạng thái trong file cấu hình | ✅ [config/claim-workflow.yaml](config/claim-workflow.yaml): 8 trạng thái, 9 lần chuyển, 5 vai trò. Engine không chứa tên trạng thái nào |
| 5 kịch bản của đề | ✅ Cả 5 đúng, thêm 1 kịch bản bổ sung (giới hạn chu kỳ). Xem [docs/scenario-output.txt](docs/scenario-output.txt) |
| Lỗi từ chối cụ thể | ✅ Nêu trạng thái nguồn, đích, các đích hợp lệ, vai trò cần có, từng điều kiện chưa đạt |
| Điều kiện tiên quyết | ✅ Kịch bản 2 chứng minh một ca không đạt; mỗi dòng của bảng đề có test riêng |
| Phân quyền theo vai trò | ✅ Có test cho từng dòng của bảng |
| Audit trail bất biến, truy vấn theo claim | ✅ [docs/audit-output.json](docs/audit-output.json) |
| Chặn chu kỳ | ✅ 3 vòng được phép, lần thứ 4 bị từ chối với đúng câu: `Maximum information requests exceeded — escalate to team lead` |
| Thêm trạng thái/lần chuyển chỉ bằng cấu hình | ✅ [docs/config-extension.diff](docs/config-extension.diff) (thêm trạng thái `ESCALATED`), có test chạy thật |
| ≥ 15 test | ✅ **172 test pass**, 1 bỏ qua có chủ đích (engine 139, API 16, web 17) |
| Giao diện | ✅ Web (Vite + React + Tailwind) gọi API Express 5 |

## 2. Cách chạy

```bash
npm install
npm run dev          # API http://localhost:3001, giao diện http://localhost:5173
npm test             # toàn bộ test
npm run scenarios    # chạy kịch bản, ghi bằng chứng vào docs/
```

Giao diện không có đăng nhập: người vận hành chọn vai trò ở góc trên phải. Hướng dẫn trải nghiệm từng bước nằm ở [docs/OPERATOR-CHECKLIST.md](docs/OPERATOR-CHECKLIST.md).

## 3. Cách làm

1. **Đọc đề, nêu chỗ mơ hồ, chờ duyệt trước khi viết code** ([PLAN.md](PLAN.md)). Các chỗ mơ hồ chính: đếm chu kỳ ở bước nào, dữ liệu để đánh giá điều kiện lấy từ đâu, có ghi lần bị từ chối vào audit không.
2. **Engine trước, giao diện sau.** Engine là TypeScript thuần, không biết HTTP hay file; mọi I/O đi qua các cổng (audit, kho claim, đồng hồ) nên test được hoàn toàn trong bộ nhớ.
3. **Kiểm tra test có thật sự bắt lỗi** bằng cách cố ý phá logic (lệch giới hạn chu kỳ, bỏ kiểm vai trò, bỏ kiểm điều kiện, bỏ kiểm quyền dữ liệu, và 5 quy tắc nghiệp vụ về sau). Mọi lần phá đều làm test đỏ.
4. **Vận hành thử giao diện trong trình duyệt thật** và chủ dự án tự vận hành, tìm ra lỗi mà test tự động không thấy (mục 5).

## 4. Thiết kế cốt lõi

Mỗi lần chuyển trạng thái đi qua các cổng theo thứ tự cố định; cổng đầu tiên không đạt sẽ từ chối và ghi audit:

`lý do → vai trò hợp lệ → transition tồn tại → vai trò được phép → dữ liệu hợp lệ và quyền sửa → giới hạn chu kỳ → điều kiện tiên quyết → commit nguyên tử → tác dụng phụ`

Các điểm đáng chú ý:

- **Từ chối mặc định:** giá trị thiếu, sai kiểu, khóa lạ, vai trò lạ đều bị từ chối. Tiền là số nguyên theo đơn vị nhỏ nhất, không dùng số thực. Thời gian UTC.
- **Điều kiện khai báo**, không dùng `eval`: `exists`, `nonEmpty`, `isTrue`, `isPast`, `isFuture`, `includesAll`, `lte`, `any`, `all`. Điều kiện `HOẶC` của `REJECTED → CLOSED` dùng `any`.
- **Audit:** mỗi mục có thời gian, trạng thái nguồn và đích, người thực hiện (id và vai trò), lý do, kết quả `APPLIED` hoặc `DENIED`, thay đổi dữ liệu trước và sau. Là chuỗi băm SHA-256 chỉ ghi nối; file bị sửa, xóa hay đổi thứ tự thì hệ thống từ chối khởi động. Giới hạn: chống giả mạo được nhưng không chống xóa toàn bộ file.
- **Chu kỳ:** bộ đếm lấy từ chính audit nên không thể bị đặt lại.
- **Nguyên tử:** nếu ghi audit lỗi thì claim được hoàn tác và không tác dụng phụ nào được phát ra. Tác dụng phụ chỉ phát ra (console) sau khi chuyển trạng thái đã commit.
- **Quyền sửa từng trường dữ liệu** (`dataAccess` trong cấu hình): mỗi vai trò chỉ sửa dữ liệu ở đúng giai đoạn của mình. Nếu không, một vai trò có thể tự thỏa điều kiện bằng cách sửa dữ liệu không thuộc quyền. Đây là phần bổ sung ngoài đề.

Danh sách đầy đủ 20 quyết định, kèm lý do và đánh đổi, ở [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md).

## 5. Lỗi và sửa đổi trong quá trình làm

**Bốn lỗi chỉ thấy khi dùng giao diện thật** (test tự động không bắt được): hai panel dùng chung một `key` làm React nhân bản panel mỗi lần đổi vai trò; biến `PORT` chung làm API và web tranh cổng; thông báo kết quả nằm ở đầu trang nên bị khuất khi bấm nút ở phần thấp; ô lý do giữ nội dung cũ khi đổi vai trò. Cả bốn đã sửa.

**Năm lỗ hổng nghiệp vụ do chủ dự án phát hiện khi vận hành thử**, đã sửa kèm 31 test mới:

1. Quay lại bước xác minh không kiểm đủ giấy tờ → nay kiểm đủ như lần đầu, dùng chung một danh sách trong cấu hình.
2. Thẩm định một lần rồi duyệt luôn sau khi nhận thêm thông tin → nay mỗi lần quay lại xóa kết quả thẩm định cũ, phải thẩm định lại.
3. Nhân viên văn phòng sửa được số tiền lúc thẩm định → nay mỗi vai trò chỉ sửa dữ liệu ở giai đoạn của mình.
4. Người thẩm định hạ số tiền yêu cầu để duyệt → nay số tiền yêu cầu cố định từ lúc tiếp nhận, thêm ô số tiền được duyệt riêng.
5. Hạn khiếu nại đặt được ở quá khứ → nay phải sau thời điểm từ chối.

## 6. Giả định và giới hạn

**Giả định** (có thể đổi trong `claim-workflow.yaml`):
- Giấy tờ bắt buộc là `claim_form`, `identity_document`, `supporting_evidence` (đề chỉ nói "các giấy tờ cần thiết").
- Hạn khiếu nại do người thẩm định đặt khi từ chối; thành viên xác nhận do vai trò `system` ghi nhận.
- Số tiền được duyệt không được vượt số tiền yêu cầu.
- Hồ sơ chạm giới hạn chu kỳ dừng ở `UNDER_ASSESSMENT` chờ team lead; đề không định nghĩa bước tiếp theo. Ví dụ `ESCALATED` trong `docs/examples` cho thấy cách thêm bằng cấu hình, nhưng chưa nằm trong cấu hình chính.

**Giới hạn:**
- **Không có xác thực**: ai cũng tự chọn được vai trò (theo yêu cầu của chủ dự án). Engine vẫn cưỡng chế phân quyền theo vai trò nhận được.
- Chạy một process, xử lý đồng bộ; lưu bằng file, không phải cơ sở dữ liệu.
- Tác dụng phụ chỉ là mô phỏng ghi ra console. Hệ thống thật cần outbox pattern.
- Không có đường chạy kịch bản trên giao diện; chạy bằng `npm run scenarios`.
- **Chưa kiểm:** chế độ sáng của hệ điều hành, trình duyệt ngoài Chromium, hai tab cùng thao tác một hồ sơ.

## 7. Sử dụng AI

Toàn bộ bài làm được thực hiện cùng Claude Code trong một phiên làm việc: phân tích đề, thiết kế, viết code, test và tài liệu. Con người quyết định các điểm chính: stack, bỏ xác thực, duyệt các quyết định D1 và D2, xác nhận D18 và D19, và phát hiện 5 lỗ hổng nghiệp vụ ở mục 5.

Nhật ký hội thoại gốc, không chỉnh sửa, xuất bằng công cụ của ứng dụng: [docs/ai-conversation-log/](docs/ai-conversation-log/).

## 8. Bản đồ tài liệu

| Tài liệu | Nội dung |
|---|---|
| [README.md](README.md) | Cách chạy, kiến trúc, bảng bằng chứng |
| [PLAN.md](PLAN.md) | Kế hoạch đã duyệt, trạng thái thực hiện |
| [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md) | 20 quyết định thiết kế |
| [docs/OPERATOR-CHECKLIST.md](docs/OPERATOR-CHECKLIST.md) | Checklist trải nghiệm hệ thống |
| [docs/scenario-output.txt](docs/scenario-output.txt) | Kết quả chạy các kịch bản, kèm audit trail |
| [docs/audit-output.json](docs/audit-output.json) | Nhật ký audit của từng kịch bản (JSON) |
| [docs/config-extension.diff](docs/config-extension.diff) | Bản diff thêm trạng thái bằng cấu hình |
