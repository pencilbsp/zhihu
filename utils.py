import asyncio
import base64
import re
from pathlib import Path

from playwright.async_api import async_playwright, Page, Browser, Error as PlaywrightError


async def get_text_and_download_font(url: str, output_dir: str = "."):
    """
    Duyệt đến `url`, trích xuất nội dung text trong #manuscript, tìm @font-face có font-family khớp,
    rồi nếu gặp data-URI base64, giải mã và ghi thành file font.<ext> trong thư mục output_dir.
    """
    playwright = await async_playwright().start()
    browser: Browser = None
    page: Page = None

    try:
        browser = await playwright.chromium.launch(
            headless=False,
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )
        page = await browser.new_page()
        await page.goto(url, wait_until="load")

        # Đợi selector #manuscript
        await page.wait_for_selector("#manuscript")

        # Bước A: Lấy text và fontFamily từ #manuscript
        content = await page.eval_on_selector(
            "#manuscript",
            """div => {
                const fontFamily = div.style.fontFamily;
                const textTags = div.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
                const result = Array.from(textTags)
                    .map(el => el.textContent?.trim() || "")
                    .join("\\n");
                return { text: result, fontFamily };
            }""",
        )

        if not content:
            raise RuntimeError("Không tìm thấy nội dung trong #manuscript")

        font_family: str = content["fontFamily"]
        # Lấy phần trước dấu phẩy đầu tiên làm fontKey
        font_key = font_family.split(",")[0].strip()
        if not font_key:
            raise RuntimeError("Không lấy được fontKey từ fontFamily")

        # Bước B: Tìm @font-face rule có font-family = font_key, trả về src
        font_src = await page.evaluate(
            """(fontKey) => {
                for (const sheet of Array.from(document.styleSheets)) {
                    let rules;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        continue;  // bỏ qua trường hợp không thể truy cập (CORS)
                    }
                    for (const r of Array.from(rules)) {
                        if (r instanceof CSSFontFaceRule) {
                            const ffFamily = r.style
                                .getPropertyValue("font-family")
                                .replace(/["']/g, "")
                                .trim();
                            if (ffFamily === fontKey) {
                                return r.style.getPropertyValue("src");
                            }
                        }
                    }
                }
                return null;
            }""",
            font_key,
        )

        if not font_src:
            raise RuntimeError(f"Không tìm thấy @font-face nào với font-family = '{font_key}'")

        # Bước C: Check xem font_src có phải data URI base64 không
        # Ví dụ: url("data:font/woff2;charset=utf-8;base64,AAA...") format("woff2")
        data_uri_pattern = re.compile(r'url\("data:font/(\w+);charset=utf-8;base64,(.*?)"\)')
        match = data_uri_pattern.search(font_src)

        if match:
            extension, b64_data = match.groups()
            # Giải mã base64 --> bytes
            font_bytes = base64.b64decode(b64_data)

            # Tạo thư mục đầu ra nếu chưa tồn tại
            out_dir_path = Path(output_dir)
            out_dir_path.mkdir(parents=True, exist_ok=True)

            # Ghi file nhị phân
            font_path = out_dir_path / f"font.{extension}"
            with open(font_path, "wb") as f:
                f.write(font_bytes)

            print(f"Đã lưu font tại: {font_path.resolve()}")
        else:
            raise RuntimeError("Không thể xác định nguồn font từ fontSrc")

    except PlaywrightError as e:
        print(f"Lỗi khi dùng Playwright: {e}")
        raise
    finally:
        # Đảm bảo đóng page và browser
        if page:
            try:
                await page.close()
            except:
                pass
        if browser:
            try:
                await browser.close()
            except:
                pass
        await playwright.stop()


# Ví dụ gọi hàm
if __name__ == "__main__":
    url_to_scrape = "https://www.zhihu.com/market/paid_column/1822324978940571648/section/1824497947582267392"
    # output_dir = "."  # Hoặc đường dẫn bạn muốn lưu font
    asyncio.run(get_text_and_download_font(url_to_scrape, output_dir="."))
