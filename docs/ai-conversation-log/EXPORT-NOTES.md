# Ghi chú về nhật ký hội thoại AI

Thư mục này có ba loại file:

| File | Là gì | Dành cho |
|---|---|---|
| `session-export-1793459887408.zip` | **Bản gốc**, xuất bằng công cụ của ứng dụng Claude, sao chép nguyên vẹn, không chỉnh sửa. Đây là nguồn chuẩn | Lưu trữ, đối chiếu |
| `CONVERSATION.md` | Bản Markdown gọn: tin nhắn của người dùng, câu trả lời của AI, danh sách công cụ đã gọi | Người đọc |
| `CONVERSATION-FULL.md` | Bản Markdown đầy đủ: thêm tham số và kết quả của mọi lần gọi công cụ, phần suy luận được ghi lại, ngữ cảnh hệ thống | AI, hệ thống khác, người cần chi tiết |

Ghi chú này do người làm bài viết thêm, không nằm trong file zip.

## Bản gốc

- Công cụ xuất: chức năng xuất transcript của ứng dụng Claude (Code tab), phiên "Git initialization".
- Thời điểm xuất: 31/10/2026, ghi nhận cuối cùng trong file lúc 15:17:41 UTC.
- SHA-256 của file zip: `e78490cb0b91bdf9738036b747983c20f9393661b1b2fea7bb4b4e71652dda3b`
- SHA-256 của `transcript.jsonl` bên trong: `4d82a8d5c86fbc5c0c9497d502951c8eca86e366e1b4cdb644ed940edfa183b3` (cũng ghi ở đầu hai file Markdown).
- `transcript.jsonl`: 2055 dòng JSON, đọc được hết; trùng từng byte với file phiên gốc của ứng dụng trong cùng zip.

## Hai file Markdown được tạo thế nào

Sinh tự động bằng [scripts/transcript-to-md.mjs](../../scripts/transcript-to-md.mjs), không viết tay. Để tự tạo lại và đối chiếu:

```bash
unzip -p docs/ai-conversation-log/session-export-1793459887408.zip transcript.jsonl > transcript.jsonl
node scripts/transcript-to-md.mjs transcript.jsonl CONVERSATION.md compact "session-export-1793459887408.zip / transcript.jsonl"
node scripts/transcript-to-md.mjs transcript.jsonl CONVERSATION-FULL.md full "session-export-1793459887408.zip / transcript.jsonl"
```

Kết quả phải giống từng byte với hai file trong thư mục này.

Đã kiểm tra khi tạo: mọi nội dung sau đều xuất hiện **nguyên văn** trong file Markdown tương ứng.

| Nội dung | Bản gọn | Bản đầy đủ |
|---|---|---|
| Tin nhắn người dùng, thông báo và lệnh cục bộ của ứng dụng (33) | 33/33 | 33/33 |
| Tin nhắn gửi giữa lượt làm việc (1) | 1/1 | 1/1 |
| Đoạn trả lời của AI (72) | 72/72 | 72/72 |
| Tham số gọi công cụ (342) | chỉ tên và mô tả | 342/342 |
| Đoạn văn bản trong kết quả công cụ (499) | không có | 499/499 |
| Khối suy luận có nội dung (16) | không có | 16/16 |

Mọi khối mã đều đóng đúng; chạy script hai lần cho cùng một kết quả.

## Giới hạn, cần nói rõ

1. **Phần suy luận nội bộ của AI gần như không có**: bản xuất có 132 khối "thinking" nhưng chỉ 16 khối có nội dung, còn lại rỗng. Đây là cách công cụ xuất của ứng dụng ghi lại, không phải do người làm bài lược bỏ.
2. **Lượt trả lời bị bộ lọc an toàn của ứng dụng dừng**: hai lần, không có nội dung nào của chúng được ghi trong bản xuất. Thông báo của ứng dụng về việc này có trong nhật ký. Hai bản ghi lỗi liên quan được thay bằng dòng ghi chú trong file Markdown; nguyên bản có trong zip.
3. **Bản xuất dừng giữa lượt làm việc cuối**: không chứa việc tạo file Markdown, câu trả lời cuối, xác nhận của chủ dự án trước khi push, và việc push.
4. Một tin nhắn của chủ dự án xuất hiện hai lần (gửi lại sau khi lượt trả lời bị dừng); cả hai đều được giữ nguyên.
5. File có chứa địa chỉ email của chủ dự án, mã tổ chức (UUID) và đường dẫn thư mục trên máy. Không có token hay khóa bí mật (đã quét). Không được chỉnh sửa vì yêu cầu nhật ký nguyên bản.
6. Phiên chuyển từ mô hình `claude-sonnet-5-5` sang `claude-opus-5-5` ở lượt cuối (lệnh `/model` có trong nhật ký).
7. `CONVERSATION-FULL.md` khoảng 1,1 MB; GitHub có thể không hiển thị đẹp file lớn như vậy, khi đó hãy mở dạng raw.
