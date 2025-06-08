from PIL import Image, ImageDraw, ImageFont
from io import BytesIO

def draw_text(text: str, font_path: str, font_size: int, padding: int = 10) -> bytes:
    """
    Vẽ text lên ảnh PNG với font custom, giữ chiều cao ≈ font_size (ascent+descent),
    thêm padding xung quanh, và trả về nội dung PNG dưới dạng bytes.

    :param text:        Chuỗi cần vẽ.
    :param font_path:   Đường dẫn tới file .ttf hoặc .otf.
    :param font_size:   Chiều cao mong muốn (pixel) = ascent + descent.
    :param padding:     Số pixel margin xung quanh text.
    :return:            Bytes của ảnh PNG.
    """
    # --- 1) Tạo font tạm với size = font_size để đo metrics "Hg" ---
    #    getmetrics() trả về (ascent, descent) cho font cỡ đó
    temp_font = ImageFont.truetype(font_path, font_size)
    ascent, descent = temp_font.getmetrics()
    real_sample_height = ascent + descent

    # Tính scale để tổng height ≈ font_size
    scale = font_size / real_sample_height
    adjusted_size = int(font_size * scale)

    # --- 2) Tạo một ImageDraw tạm để đo kích thước text với font đã scale ---
    temp_img = Image.new("RGB", (1, 1))
    temp_draw = ImageDraw.Draw(temp_img)
    scaled_font = ImageFont.truetype(font_path, adjusted_size)
    # Dùng textbbox để lấy bounding box chính xác
    bbox = temp_draw.textbbox((0, 0), text, font=scaled_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    # ascent_scaled = scaled_font.getmetrics()[0]
    # descent_scaled = scaled_font.getmetrics()[1]
    # total_height = ascent_scaled + descent_scaled  # Xác nhận ≈ font_size

    # --- 3) Tính kích thước final canvas (image) ---
    canvas_width = text_width + padding * 2
    canvas_height = text_height + padding * 2

    # --- 4) Tạo ảnh mới, vẽ nền trắng, rồi vẽ text với baseline = "alphabetic" ---
    img = Image.new("RGB", (canvas_width, canvas_height), color="#ffffff")
    draw = ImageDraw.Draw(img)
    # Vị trí vẽ: x = padding; y = padding + ascent_scaled
    # Nhưng textbbox trả bounding box ở (0, 0) tương ứng góc trên-left. Để sử dụng baseline="alphabetic",
    # PIL không hỗ trợ trực tiếp, ta có thể vẽ tại (padding, padding) vì textbbox chứa cả descent.
    # Tuy nhiên, để mô phỏng giống canvas baseline="alphabetic", ta dùng:
    scalar_ascent = scaled_font.getmetrics()[0]
    x = padding
    y = padding  # vẽ sao cho top của textBBox nằm tại padding

    draw.text((x, y), text, font=scaled_font, fill="#000000")

    # --- 5) Convert ảnh thành bytes PNG và trả về ---
    output = BytesIO()
    img.save(output, format="PNG")
    return output.getvalue()


# Ví dụ sử dụng:
if __name__ == "__main__":
    # Một số test text (có thể chứa tiếng Trung)
    test_text = "闺蜜和婚礼力，有。成郎和哥哥，高冷医：江慕泽个见钟情对"
    font_file = "zhihu_font.ttf"  # đường dẫn tới font custom của bạn
    font_h = 50  # Chiều cao mong muốn (ascent+descent) ≈ 50px
    png_bytes = draw_text(test_text, font_file, font_h, padding=10)
    # Lưu ra file để kiểm tra
    with open("output.png", "wb") as f:
        f.write(png_bytes)
