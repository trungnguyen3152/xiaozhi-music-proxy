# xiaozhi-music-proxy

Tìm bài hát trên YouTube, tách lấy audio (không lấy video), phát ra dạng PCM thô
để board ESP32-S3 (XiaoZhi) phát trực tiếp qua loa.

## API

### `GET /play?q=<từ khóa>`

Trả về audio thô (raw PCM, 16-bit signed little-endian, mono, 24000 Hz) của kết
quả YouTube đầu tiên khớp với `q`, phát trực tiếp theo dạng stream (không chờ
tải xong mới gửi).

```
GET /play?q=son%20tung%20mtp%20chac%20ai%20do%20se%20ve
```

### `GET /health`

Kiểm tra server còn sống.

## Chạy thử tại máy (Linux/macOS, cần cài sẵn `yt-dlp` và `ffmpeg`)

```bash
npm install
npm start
curl "http://localhost:8080/play?q=test" --output test.pcm
```

## Deploy lên Railway

Project có sẵn `Dockerfile` (cài `ffmpeg` + `yt-dlp` trong image) — Railway sẽ
tự nhận diện và build từ đó. Không cần cấu hình thêm ngoài việc trỏ domain
public tới service.
