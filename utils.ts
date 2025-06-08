import { spawn } from "bun";
import { chromium, type Browser, type Page } from "playwright-core";
import { createCanvas, registerFont } from "canvas";

// 1. Đăng ký font TTF
registerFont("zhihu_font.ttf", { family: "CustomFont" });

/**
 * Vẽ text lên Canvas, đảm bảo margin trên/dưới, rồi lưu PNG với tên MD5(text).png
 * @param text Chuỗi cần vẽ
 * @param fontSize Chiều cao mong muốn (px) của font (khoảng ascent+descent ≈ fontSize)
 * @param padding Margin (px) cho cả 4 cạnh
 */
function drawText(text: string, fontSize: number, padding: number = 10) {
    // --- 1) Tạo canvas tạm để đo độ cao thực của một font mẫu “Hg” ---
    //    (dùng để tính scale sao cho ascent+descent ≈ fontSize)
    let canvas = createCanvas(1000, 200);
    let ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px CustomFont`;
    let metricsSample = ctx.measureText("Hg");
    let realSampleHeight =
        metricsSample.actualBoundingBoxAscent +
        metricsSample.actualBoundingBoxDescent;
    const scale = fontSize / realSampleHeight;
    const adjustedSize = fontSize * scale;

    // --- 2) Đo width và height của chính đoạn text cần vẽ (với font đã scale) ---
    ctx.font = `${adjustedSize}px CustomFont`;
    let metricsText = ctx.measureText(text);
    // actualBoundingBoxAscent = khoảng từ baseline lên đỉnh
    // actualBoundingBoxDescent = khoảng từ baseline xuống đáy
    const ascent = metricsText.actualBoundingBoxAscent;
    const descent = metricsText.actualBoundingBoxDescent;
    const textWidth = metricsText.width;
    const textHeight = ascent + descent;

    // --- 3) Tính kích thước canvas mới, gồm đủ margin trên/dưới/trái/phải ---
    const canvasWidth = Math.ceil(textWidth + padding * 2);
    const canvasHeight = Math.ceil(textHeight + padding * 2);

    // Tạo lại canvas với đúng kích thước
    canvas = createCanvas(canvasWidth, canvasHeight);
    ctx = canvas.getContext("2d");

    // --- 4) Vẽ nền trắng, rồi vẽ text với textBaseline="alphabetic" ---
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.font = `${adjustedSize}px CustomFont`;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "alphabetic";
    // Với baseline="alphabetic", nếu bạn vẽ ở y = padding + ascent,
    // đỉnh glyph sẽ nằm tại y = (padding + ascent) - ascent = padding,
    // và đáy glyph nằm tại y = (padding + ascent) + descent = padding + textHeight.
    const x = padding;
    const y = padding + ascent;
    ctx.fillText(text, x, y);

    const imgBuf = canvas.toBuffer("image/png");

    return imgBuf;
}

export async function macOCR(text: string) {
    const imageBuff = drawText(text, 100, 10);

    const fastMode = false;
    const languageCorrection = true;
    const languages = ["zh-Hans"];

    const proc = spawn(
        [
            "./ocrtool",
            languages.join(","),
            fastMode ? "true" : "false",
            languageCorrection ? "true" : "false",
            "-",
        ],
        {
            stdin: new Uint8Array(imageBuff),
        },
    );

    // 5. Đợi tiến trình kết thúc, thu stdout và stderr
    await proc.exited;
    const stdoutText = await new Response(proc.stdout).text();
    return stdoutText.trim();
}

export async function getText(url: string) {
    let page: Page | null = null;
    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({
            headless: false,
            executablePath:
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        });
        page = await browser.newPage();
        await page.goto(url, { waitUntil: "load" });

        await page.waitForSelector("#manuscript");

        const content = await page.$eval("#manuscript", (div) => {
            const fontFamily = div.style.fontFamily;
            const textTags = div.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
            const result = Array.from(textTags)
                .map((el: Element) => el.textContent?.trim() || "")
                .join("\n");
            return { text: result, fontFamily };
        });

        if (!content) {
            throw new Error("Không tìm thấy nội dung");
        }

        const fontKey = content.fontFamily.split(",")[0]!.trim();

        // Bước B: Trong context trang, tìm @font-face rule có font-family = fontKey, trả về src
        const fontSrc: string | null = await page.evaluate((fontKey) => {
            // Duyệt qua tất cả StyleSheet
            for (const sheet of Array.from(document.styleSheets)) {
                let rules;
                try {
                    rules = (sheet as CSSStyleSheet).cssRules;
                } catch {
                    // Bỏ qua nếu không thể truy cập (ví dụ CORS)
                    continue;
                }
                for (const r of Array.from(rules)) {
                    // Kiểm tra nếu là @font-face
                    if (r instanceof CSSFontFaceRule) {
                        const ffRule = r as CSSFontFaceRule;
                        // Lấy giá trị font-family (thường ở dạng '"fontKey"' hoặc 'fontKey')
                        const ffFamily = ffRule.style
                            .getPropertyValue("font-family")
                            .replace(/["']/g, "")
                            .trim();
                        if (ffFamily === fontKey) {
                            // Lấy src (có thể là url("...") hoặc data:base64,...)
                            const src = ffRule.style.getPropertyValue("src");
                            return src; // Trả về ngay khi tìm được
                        }
                    }
                }
            }
            return null;
        }, fontKey);

        if (!fontSrc) {
            throw new Error("Không tìm thấy @font-face nào với font-family =");
        }

        const regex = /url\("data:font\/(\w+);charset=utf-8;base64,(.*?)"\)/;
        if (regex.test(fontSrc)) {
            const [, extension, base64] = regex.exec(fontSrc) || [];
            // write to file
            const binStr = atob(base64!);
            const len = binStr.length;
            const u8 = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                u8[i] = binStr.charCodeAt(i);
            }

            await Bun.write(`font.${extension || "ttf"}`, u8);
        } else {
            throw new Error("Không thể xác định nguồn font");
        }

        await browser.close();
        await page.close();
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        if (page) {
            await page.close();
        }

        throw error;
    }
}
