# Claim Workflow Orchestrator

Công cụ điều phối vòng đời claim bảo hiểm bằng **máy trạng thái định nghĩa trong file cấu hình**: kiểm tra chuyển trạng thái, điều kiện tiên quyết, tác dụng phụ (mock), phân quyền theo vai trò, nhật ký kiểm toán bất biến và giới hạn chu kỳ yêu cầu thông tin. Đề bài: [CHALLENGE.md](CHALLENGE.md).

**Bài nộp gồm hai phần trong cùng repo:**
- Phần 1, câu hỏi logic: [logical-questions/answers.md](logical-questions/answers.md)
- Phần 2, AI Engineering Challenge 14: báo cáo ở [REPORT.md](REPORT.md), nhật ký làm việc với AI ở [docs/ai-conversation-log/](docs/ai-conversation-log/)

- **Engine** (`packages/engine`): TypeScript thuần, không biết HTTP hay file.
- **API** (`apps/api`): Express 5 + zod.
- **Web** (`apps/web`): Vite + React + Tailwind CSS.
- **Cấu hình**: [config/claim-workflow.yaml](config/claim-workflow.yaml) là nguồn sự thật duy nhất.

## Chạy

Cần Node 20+.

```bash
npm install
npm run dev          # API http://localhost:3001 + Web http://localhost:5173
npm test             # toàn bộ test (engine, API, web)
npm run typecheck
npm run scenarios    # chạy 5 kịch bản của đề + 1 kịch bản bổ sung, ghi bằng chứng vào docs/
```

Dữ liệu chạy thật lưu ở `data/` (đã gitignore): `claims.json` và `audit.jsonl` (chỉ ghi nối). Xóa thư mục này để bắt đầu lại từ đầu.

Biến môi trường tùy chọn: `API_PORT` (mặc định 3001), `DATA_DIR`, `WORKFLOW_CONFIG`, `CORS_ORIGIN`.

## Bằng chứng nộp bài

| Yêu cầu của đề | Ở đâu |
|---|---|
| Cấu hình máy trạng thái | [config/claim-workflow.yaml](config/claim-workflow.yaml) |
| Kết quả chạy các kịch bản | [docs/scenario-output.txt](docs/scenario-output.txt) |
| Đầu ra nhật ký kiểm toán | [docs/audit-output.json](docs/audit-output.json) (và phần "Audit trail" trong scenario-output.txt) |
| Thêm trạng thái/transition chỉ bằng cấu hình (bản diff) | [docs/config-extension.diff](docs/config-extension.diff), cấu hình đầy đủ ở [docs/examples/](docs/examples/claim-workflow.with-escalation.yaml), được kiểm chứng bằng `extension.test.ts` |
| Ghi chú cách làm và quyết định | [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md) |
| Checklist trải nghiệm hệ thống | [docs/OPERATOR-CHECKLIST.md](docs/OPERATOR-CHECKLIST.md) |
| Kế hoạch đã duyệt | [PLAN.md](PLAN.md) |
| Nhật ký hội thoại AI gốc | [docs/ai-conversation-log/](docs/ai-conversation-log/): file zip nguyên bản, kèm bản Markdown để đọc ([gọn](docs/ai-conversation-log/CONVERSATION.md), [đầy đủ](docs/ai-conversation-log/CONVERSATION-FULL.md)) sinh tự động bằng `scripts/transcript-to-md.mjs` |

## Các kịch bản

| # | Kịch bản | Kết quả mong đợi |
|---|---|---|
| 1 | Happy path | `SUBMITTED → … → CLOSED` |
| 2 | Từ chối | `… → REJECTED → CLOSED`; kèm ca đóng sớm bị từ chối vì chưa hết hạn khiếu nại (điều kiện không đạt) |
| 3 | Vòng yêu cầu thông tin | đi qua `PENDING_INFO` rồi quay lại và hoàn tất |
| 4 | Chuyển không hợp lệ | `SUBMITTED → APPROVED` bị từ chối với lỗi cụ thể |
| 5 | Sai vai trò | vai trò không được phép bị từ chối |
| 6 (bổ sung) | Giới hạn chu kỳ | 3 vòng được phép, lần yêu cầu thứ 4 bị chặn với đúng thông báo của đề |

## Kiến trúc

```
config/claim-workflow.yaml      trạng thái, transition, vai trò, điều kiện, tác dụng phụ, quyền sửa dữ liệu
packages/engine/
  src/config      schema (zod) + kiểm tra chéo + loader
  src/core        pipeline chuyển trạng thái (engine.ts)
  src/conditions  đánh giá điều kiện tiên quyết (khai báo, không eval)
  src/effects     lập kế hoạch tác dụng phụ (mock, ghi console)
  src/adapters    audit log (hash chain, JSONL), kho claim, đồng hồ
  scenarios/      bộ kịch bản + harness dùng chung cho test và runner
apps/api          Express 5: validate request, ánh xạ mã lỗi sang HTTP
apps/web          giao diện vận hành
```

Pipeline cho mỗi lần chuyển, dừng ở cổng đầu tiên không đạt (và ghi audit `DENIED`):
lý do → vai trò hợp lệ → transition tồn tại → vai trò được phép → dữ liệu hợp lệ → quyền sửa dữ liệu → giới hạn chu kỳ → điều kiện tiên quyết → commit nguyên tử → tác dụng phụ.

## Giới hạn đã biết

- **Không có xác thực**: người vận hành tự chọn vai trò trên giao diện (quyết định D3, theo yêu cầu). Engine vẫn cưỡng chế phân quyền theo vai trò nhận được; việc chứng minh danh tính nằm ngoài phạm vi.
- Một process, xử lý đồng bộ; không có khóa phân tán hay nhiều process dùng chung dữ liệu.
- Tác dụng phụ chỉ là mock ghi console.
- Mã claim tăng dần (`CLM-0001`, …), phù hợp demo.
