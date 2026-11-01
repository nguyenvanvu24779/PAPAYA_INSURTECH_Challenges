# Ghi chú thiết kế và các quyết định

## Cách làm

1. Đọc kỹ đề, liệt kê các chỗ mơ hồ, đề xuất và chờ chủ dự án duyệt trước khi viết code ([PLAN.md](../PLAN.md), mục 8).
2. Xây engine trước (cấu hình → schema → pipeline → audit), có test từng cổng, rồi mới làm API và giao diện.
3. Kiểm tra test có thật sự bắt lỗi bằng **mutation**: cố ý phá logic (lệch giới hạn chu kỳ, bỏ kiểm vai trò, bỏ kiểm điều kiện, bỏ kiểm quyền dữ liệu) và xác nhận test chuyển đỏ.
4. Vận hành thử giao diện trong trình duyệt như người dùng thật (xem [OPERATOR-CHECKLIST.md](OPERATOR-CHECKLIST.md)).

## Nguyên tắc cho core logic (bảo hiểm / tài chính)

- **Từ chối mặc định (fail-closed)**: giá trị thiếu, sai kiểu, khóa lạ, vai trò lạ đều bị từ chối, không bao giờ cho qua.
- **Tiền là số nguyên theo đơn vị nhỏ nhất**, không dùng số thực; từ chối số âm, số thập phân, `NaN`, số vượt ngưỡng an toàn.
- **Thời gian UTC, định dạng ISO 8601**; đồng hồ là một port để test được hạn khiếu nại chính xác đến mili-giây.
- **Chuyển nguyên tử**: nếu ghi audit lỗi, claim được khôi phục và không tác dụng phụ nào được phát ra.
- **Không tự quyết điều đề chưa nói rõ**: mọi giả định bên dưới đều được ghi lại.

## Quyết định

| # | Quyết định | Lý do | Đánh đổi / ghi chú |
|---|---|---|---|
| D1 | Audit ghi cả lần bị từ chối (`outcome: DENIED`, kèm mã lỗi và thông báo) | Chứng minh được kịch bản 4, 5; có dấu vết các nỗ lực trái phép | Đề chỉ nói "mỗi lần chuyển"; người chấm có thể chỉ kỳ vọng các mục thành công. Lọc theo `outcome` là đủ. **Đã duyệt** |
| D2 | Đếm chu kỳ tại `UNDER_ASSESSMENT → PENDING_INFO`: 3 lần được phép, lần thứ 4 bị chặn bằng đúng thông báo của đề | Khớp "ở lần thứ 4 từ chối" | Bộ đếm lấy từ chính audit nên không thể bị đặt lại. Lần bị từ chối không tính vào số đếm. Hồ sơ dừng ở `UNDER_ASSESSMENT`; đề không định nghĩa bước leo thang tiếp theo (xem D16). **Đã duyệt** |
| D3 | Không xác thực; vai trò chọn trên giao diện | Mục tiêu là core logic; đề không yêu cầu | Ai cũng tự nhận được vai trò. **Đã chốt theo yêu cầu** |
| D4 | Điều kiện tiên quyết khai báo (`exists`, `nonEmpty`, `isTrue`, `isPast`, `includesAll`, `lte`, `any`, `all`), không dùng `eval` | An toàn, dễ diff, dễ giải thích | Loại kiểm tra mới cần thêm vào code; dùng lại loại có sẵn thì chỉ cần sửa cấu hình |
| D5 | Tác dụng phụ được **lập kế hoạch trước khi commit** và **chỉ phát ra (console) sau khi commit thành công**; tác dụng phụ lỗi không rollback chuyển trạng thái, được ghi vào audit với `status: FAILED` | Đề: "chạy tác dụng phụ sau khi chuyển thành công"; tránh trạng thái nửa vời | Với hệ thống thật cần outbox pattern |
| D6 | Lưu trữ: claim trong `claims.json`, audit trong `audit.jsonl` (chỉ ghi nối) | Đủ cho demo, còn dữ liệu sau khi khởi động lại | Một process, không scale |
| D7 | `data` gửi kèm lệnh chuyển được gộp để kiểm tra, chỉ lưu nếu chuyển thành công | Dữ liệu từ lần thử thất bại không rò vào hồ sơ | Có test xác nhận hồ sơ không đổi sau lần bị từ chối |
| D8 | **Quyền sửa từng trường dữ liệu** (`dataAccess` trong cấu hình): mỗi trường chỉ một số vai trò được sửa, trong một số trạng thái. Trường không có luật (`paymentRequestId`, `assessmentStartedAt`) là của hệ thống, chỉ tác dụng phụ ghi được. Cùng luật áp dụng cho `data` gửi kèm lệnh chuyển | Nếu không, một vai trò có thể tự thỏa điều kiện bằng cách sửa dữ liệu không thuộc quyền (ví dụ tự đặt `assessmentReportComplete` hoặc tự tạo mã yêu cầu thanh toán). **Đây là bổ sung của mình ngoài đề, cần chủ dự án xác nhận** | Mọi thay đổi dữ liệu đều có dòng audit `DATA_UPDATE` kèm giá trị trước/sau. Danh sách vai trò theo trường là giả định hợp lý, sửa được trong YAML |
| D9 | Audit là chuỗi băm (SHA-256, mỗi mục chứa băm của mục trước) | Phát hiện sửa, xóa, đổi thứ tự lịch sử; file bị can thiệp thì hệ thống từ chối khởi động | Chống giả mạo (tamper-evident), không chống được việc xóa toàn bộ file |
| D10 | `isPast` là so sánh nghiêm ngặt: đúng thời điểm hạn khiếu nại vẫn **chưa** hết hạn | Fail-closed: không đóng hồ sơ sớm làm mất quyền khiếu nại | Có test ca biên chính xác đến mili-giây |
| D11 | Khi quay lại từ `PENDING_INFO`, xóa `newInfoReceived`, `missingInfoDescription`, `assessmentStartedAt` **và toàn bộ kết quả thẩm định cũ** (`assessmentReportComplete`, `approvedAmount`, `rejectionReason`, `appealDeadline`) | Cờ cũ của vòng trước không được thỏa điều kiện vòng sau; mỗi lần quay lại phải thẩm định lại từ đầu (xem D17); đồng thời là "đặt lại đồng hồ thẩm định" của đề | Giữ nguyên số tiền yêu cầu, hạn mức và người thẩm định đã chỉ định (team lead vẫn phải bấm bắt đầu thẩm định lại). Có test |
| D12 | Danh sách giấy tờ bắt buộc: `claim_form`, `identity_document`, `supporting_evidence` | Đề chỉ nói "các giấy tờ cần thiết" | **Giả định**, đổi trong YAML |
| D13 | Mọi lần chuyển và sửa dữ liệu bắt buộc có lý do/ghi chú | Đề yêu cầu audit có lý do | Thiếu lý do bị từ chối và ghi audit |
| D14 | Từ chối (`REJECTED`) bắt buộc phải có `appealDeadline`, và hạn này phải **sau thời điểm từ chối** (xem D20); `memberAcknowledged` do vai trò `system` ghi | Để `REJECTED → CLOSED` ("hết hạn khiếu nại HOẶC thành viên xác nhận") có dữ liệu để đánh giá | Giả định |
| D15 | Mã lỗi: 400 dữ liệu/lý do sai, 403 sai vai trò hoặc quyền dữ liệu, 409 transition không tồn tại / chạm giới hạn / điều kiện chưa đạt, 404 không có claim, 500 lỗi lạ (không lộ chi tiết nội bộ) | Phân biệt lỗi người dùng với lỗi hệ thống | |
| D17 | Quay lại `DOCUMENTS_VERIFIED` từ `PENDING_INFO` phải kiểm đủ giấy tờ **như lần đầu**: cùng danh sách, dùng chung một nguồn trong YAML (alias `*required_documents`) nên không thể lệch nhau | Trước đây chỉ cần cờ "đã nhận thông tin", nên nhân viên có thể đưa lại chỉ danh sách giấy tờ còn thiếu và hồ sơ vẫn được coi là đủ | Phải gửi danh sách đầy đủ (có thể thêm giấy tờ). Có test cho: chỉ gửi giấy tờ thiếu, thiếu một giấy tờ, đủ bộ |
| D18 | Số tiền yêu cầu `claimAmount` được đặt lúc tiếp nhận và **không bao giờ sửa lại**; người thẩm định ghi **`approvedAmount`** riêng. Duyệt yêu cầu `approvedAmount` có giá trị, `≤ coverageLimit` và `≤ claimAmount`. Yêu cầu thanh toán lấy theo `approvedAmount` | Trước đây người thẩm định hạ `claimAmount` xuống hạn mức rồi duyệt, số tiền khách yêu cầu bị mất. Hồ sơ vượt hạn mức nay vẫn duyệt được ở mức hạn mức mà không mất số liệu gốc | Quy tắc `approvedAmount ≤ claimAmount` là **bổ sung của mình** (không duyệt nhiều hơn khách yêu cầu). Không chặn `approvedAmount = 0`. **Đã được chủ dự án xác nhận** |
| D19 | Mỗi vai trò chỉ sửa dữ liệu ở giai đoạn của mình: `document_clerk` lúc tiếp nhận (`SUBMITTED`) và lúc nhận thông tin bổ sung (`PENDING_INFO`); `assessor` chỉ khi `UNDER_ASSESSMENT`; `team_lead` chỉ khi chỉ định người thẩm định; `finance` quanh thanh toán. Có test ma trận: với **mọi** trạng thái × vai trò × trường, ghi được hay không đúng bằng luật trong cấu hình | Trước đây `claimAmount` cho cả clerk và assessor sửa trong cả hai trạng thái (tích chéo vai trò × trạng thái) | **Diễn giải của mình:** clerk được sửa thêm ở `PENDING_INFO` (chỉ `documents` và `newInfoReceived`), vì đó là lúc clerk nhận giấy tờ bổ sung và là bước clerk thực hiện chuyển `PENDING_INFO → DOCUMENTS_VERIFIED`; nếu chặn thì luồng yêu cầu bổ sung không chạy được. **Đã được chủ dự án xác nhận** |
| D20 | `appealDeadline` phải **sau** thời điểm từ chối (điều kiện mới `isFuture`, so nghiêm ngặt, tính theo đồng hồ lúc từ chối). Sau khi từ chối, hạn không sửa được nữa | Trước đây đặt hạn ở quá khứ thì hệ thống đóng hồ sơ ngay, khách mất cơ hội khiếu nại | Có test: quá khứ, đúng bằng thời điểm hiện tại (từ chối), hơn 1 ms (chấp nhận), thiếu, hạn đã hết giữa lúc đặt và lúc từ chối |
| D16 | Ví dụ mở rộng bằng cấu hình: thêm trạng thái `ESCALATED` (team lead tiếp quản) và hai transition | Chứng minh yêu cầu "chỉ đổi cấu hình", đồng thời giải quyết ngõ cụt của D2 | Xem [config-extension.diff](config-extension.diff); chưa đưa vào cấu hình chính vì ngoài đề |

## Thay đổi sau khi chủ dự án duyệt lần đầu

Chủ dự án vận hành thử và chỉ ra 5 lỗ hổng nghiệp vụ; cả 5 đều đã sửa (D17 đến D20 và D11), phần lớn chỉ bằng cấu hình, kèm 31 test mới trong [business-rules.test.ts](../packages/engine/test/business-rules.test.ts). Mỗi quy tắc được kiểm chứng bằng mutation: phá quy tắc trong cấu hình thì test chuyển đỏ.

1. Giấy tờ phải được kiểm đủ lại khi quay lại bước xác minh (D17).
2. Mỗi lần quay lại phải thẩm định lại từ đầu (D11).
3. Mỗi vai trò chỉ sửa dữ liệu đúng giai đoạn của mình (D19).
4. Giữ nguyên số tiền yêu cầu, thêm ô số tiền được duyệt (D18).
5. Hạn khiếu nại phải sau thời điểm từ chối (D20).

Loại điều kiện mới duy nhất cần thêm vào code là `isFuture`; phần còn lại là thay đổi cấu hình.

## Các lỗi phát hiện khi vận hành thử trong trình duyệt

Test đơn vị và API không bắt được những lỗi sau, chỉ thấy khi dùng giao diện thật:

1. **Hai panel dùng chung một `key`** làm React không gỡ bản cũ, mỗi lần đổi vai trò lại nhân thêm một bản "Available transitions". Đã đặt key riêng; xác nhận số panel giữ nguyên 1 sau nhiều lần đổi vai trò.
2. **Biến `PORT` va chạm**: môi trường chạy thử đặt `PORT=5173` cho cả lệnh nên API cũng nghe cổng đó. Đã đổi sang biến riêng `API_PORT`.
3. **Thông báo kết quả nằm ở đầu trang**, người dùng bấm nút ở phần thấp sẽ không thấy lần bị từ chối. Đã làm banner dính (sticky) khi cuộn.
4. **Ô lý do giữ nội dung cũ khi đổi vai trò**: đã đặt lại theo vai trò.

## Việc chưa làm / ngoài phạm vi

Xác thực người dùng, cơ sở dữ liệu thật, nhiều process, phân trang, triển khai trực tuyến, nút chạy kịch bản trên giao diện (mức ưu tiên thấp trong plan).
