import os from "os";
import readline from "readline";
import { connect } from "puppeteer-real-browser";
import { type Cookie } from "rebrowser-puppeteer-core";

import { dumpFont } from "./font";
import { decodeFont, codePointToChar } from "./utils";

import map from "./SourceHanSansCN-Regular.json";

if (process.argv.length < 3) {
    console.log("Usage: zhihu [...options] <url>");
    console.log("Supported sites: zhihu.com, bjtriz.com");
    process.exit(1);
}

let url = "";
let isLogin = false;
let chromePath = "";
let outputFile = "output.txt";
let chaptersCount = 1;
let appDir: string | undefined = undefined;
let cookiePath: string | undefined = undefined;
const sys = os.platform();

if (sys === "win32") {
    console.log("Running on Windows");
    chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
} else if (sys === "darwin") {
    console.log("Running on macOS");
    chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
} else {
    console.log("Unsupported platform");
    process.exit(1);
}

if (process.env.CHROME_PATH) {
    chromePath = process.env.CHROME_PATH;
}

const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1]!;

    if (arg === "--login") {
        isLogin = true;
        i++;
        continue;
    }

    if (arg === "--url" && value) {
        url = value;
        i++;
        continue;
    }

    if (arg === "--chrome-path" && value) {
        chromePath = value;
        i++;
        continue;
    }

    if (arg === "--app-dir" && value) {
        appDir = value;
        i++;
        continue;
    }

    if ((arg === "--cookies" || arg === "-c") && value) {
        cookiePath = value;
        i++;
        continue;
    }

    if ((arg === "--output" || arg === "-o") && value) {
        outputFile = value;
        i++;
        continue;
    }

    if ((arg === "--chapters" || arg === "-n") && value) {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0) chaptersCount = n;
        i++;
        continue;
    }

    if (arg && arg.startsWith("http")) {
        url = arg;
    }
}

function connectBrowser() {
    return connect({
        headless: false,
        connectOption: { defaultViewport: null },
        customConfig: { chromePath, userDataDir: appDir },
    });
}

async function login() {
    const { page, browser } = await connectBrowser();

    // 1) Thiết lập readline để bắt keypress, bao gồm Ctrl+C
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    process.stdin.on("keypress", async (_str, key) => {
        // key.sequence === '\u0003' là Ctrl+C
        if (key.sequence === "\u0003") {
            console.log("⏳ Đang đóng trình duyệt...");
            try {
                await browser.close();
                console.log("✅ Đã đóng trình duyệt. Bye!");
            } catch (e) {
                console.error("❌ Lỗi khi đóng browser:", e);
            }
            process.exit(0);
        }
    });

    if (url.startsWith("http")) {
        await page.goto(url, { waitUntil: ["load", "networkidle0"] });
    }
}

async function parseCookies() {
    try {
        if (!cookiePath) return;

        const cookieFile = Bun.file(cookiePath);
        const isExist = await cookieFile.exists();

        if (!isExist) {
            console.warn(`Cookie file not found: ${cookiePath}`);
        } else {
            const cookieRaw = await cookieFile.text();
            return JSON.parse(cookieRaw) as Cookie[];
        }
    } catch {
        console.warn("Only support cookie JSON format");
    }
}

// ─── Detect which site we are dealing with ───────────────────────────────────
function detectSite(u: string): "zhihu" | "bjtriz" | "unknown" {
    if (u.includes("zhihu.com")) return "zhihu";
    if (u.includes("bjtriz.com")) return "bjtriz";
    return "unknown";
}

// ─── bjtriz.com (headless fetch — không cần Chrome) ──────────────────────────

const BJTRIZ_ORIGIN = "https://www.bjtriz.com";
const BJTRIZ_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: BJTRIZ_ORIGIN,
};

// Fetch /Content/icon.css và build map: "icon-N" → ký tự Unicode
async function fetchBjtrizIconMap(): Promise<Map<string, string>> {
    const css = await fetch(`${BJTRIZ_ORIGIN}/Content/icon.css`, {
        headers: BJTRIZ_HEADERS,
    }).then((r) => r.text());

    const iconMap = new Map<string, string>();
    // .icon-1:before { content: "\4e00";}
    const re = /\.icon-(\d+):before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        iconMap.set(`icon-${m[1]}`, String.fromCodePoint(parseInt(m[2], 16)));
    }
    return iconMap;
}

type BjtrizChapterMeta = {
    id: number;
    name: string;
    idx: number;
    isvip: number;
    isUnlocked: boolean;
};

// Gọi POST /api/bookchapterlist → danh sách chapter
async function fetchBjtrizChapterList(bookId: number): Promise<BjtrizChapterMeta[]> {
    const res = await fetch(`${BJTRIZ_ORIGIN}/api/bookchapterlist`, {
        method: "POST",
        headers: {
            ...BJTRIZ_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `bookid=${bookId}&device=pc`,
    });
    const json = (await res.json()) as { state: boolean; data: BjtrizChapterMeta[] };
    if (!json.state || !Array.isArray(json.data)) {
        throw new Error("[bjtriz] API trả về lỗi hoặc data không hợp lệ");
    }
    return json.data;
}

// Lấy book ID: từ URL /book/134196 hoặc parse HTML của trang chapter
async function getBjtrizBookId(inputUrl: string): Promise<number> {
    // URL dạng /book/134196
    if (!inputUrl.includes("/chapter/")) {
        const m = inputUrl.match(/\/book\/(\d+)/);
        if (m) return parseInt(m[1], 10);
    }
    // URL dạng /book/chapter/18694858 → fetch HTML, tìm "bookid: 134196"
    const html = await fetch(inputUrl, { headers: BJTRIZ_HEADERS }).then((r) => r.text());
    const m = html.match(/bookid\s*:\s*(\d+)/);
    if (!m) throw new Error("[bjtriz] Không tìm thấy book ID trong trang chapter");
    return parseInt(m[1], 10);
}

// Decode HTML entities thông dụng
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&hellip;/g, "…")
        .replace(/&ldquo;/g, "\u201c")
        .replace(/&rdquo;/g, "\u201d")
        .replace(/&lsquo;/g, "\u2018")
        .replace(/&rsquo;/g, "\u2019")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// Parse HTML chapter → { title, lines }
function parseBjtrizChapterHtml(
    html: string,
    iconMap: Map<string, string>,
): { title: string; lines: string[] } {
    // Lấy tiêu đề từ <h2>
    const titleMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch
        ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim())
        : "";

    // Tìm nội dung trong div#novelcontent bằng cách đếm depth
    const startMarker = html.indexOf('id="novelcontent"');
    if (startMarker === -1) return { title, lines: [] };

    const openTagEnd = html.indexOf(">", startMarker) + 1;
    let depth = 1;
    let pos = openTagEnd;
    while (depth > 0 && pos < html.length) {
        const nextOpen = html.indexOf("<div", pos);
        const nextClose = html.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            pos = nextOpen + 4;
        } else {
            depth--;
            pos = nextClose + 6;
        }
    }
    const content = html.slice(openTagEnd, pos - 6); // strip trailing </div>

    // Trích xuất từng <p>
    const lines: string[] = [];
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRe.exec(content)) !== null) {
        const inner = pMatch[1];
        // Resolve <i class="icon-N"></i> → ký tự, loại bỏ tag còn lại
        const resolved = decodeHtmlEntities(
            inner
                .replace(/<i\s+class="(icon-\d+)"[^>]*>\s*<\/i>/g, (_, cls) => iconMap.get(cls) ?? "")
                .replace(/<[^>]+>/g, ""),
        ).trim();
        if (resolved) lines.push(resolved);
    }

    return { title, lines };
}

async function mainBjtriz() {
    console.log("[bjtriz] 🚀 Headless fetch mode (không cần Chrome)");

    // 1. Build icon map (fetch 1 lần duy nhất)
    console.log("[bjtriz] Đang tải icon map từ CSS...");
    const iconMap = await fetchBjtrizIconMap();
    console.log(`[bjtriz] Icon map: ${iconMap.size} ký tự`);

    // 2. Lấy book ID
    const bookId = await getBjtrizBookId(url);
    console.log(`[bjtriz] Book ID: ${bookId}`);

    // 3. Lấy danh sách chapter qua API
    console.log("[bjtriz] Đang lấy danh sách chapter...");
    const chapters = await fetchBjtrizChapterList(bookId);
    console.log(`[bjtriz] Tổng số chương: ${chapters.length}`);

    // 4. Tìm vị trí bắt đầu
    const startIdMatch = url.match(/\/chapter\/(\d+)/);
    const startId = startIdMatch ? parseInt(startIdMatch[1], 10) : null;
    let fromIdx = 0;
    if (startId !== null) {
        const found = chapters.findIndex((c) => c.id === startId);
        fromIdx = found >= 0 ? found : 0;
    }
    const toDownload = chapters.slice(fromIdx, fromIdx + chaptersCount);
    console.log(
        `[bjtriz] Bắt đầu từ chương ${fromIdx + 1}/${chapters.length}, tải ${toDownload.length} chương`,
    );

    // 5. Tải và parse từng chapter
    const multiChap = toDownload.length > 1;
    // Thư mục output = outputFile bỏ phần mở rộng (vd: "output" từ "output.txt")
    const outDir = outputFile.replace(/\.[^.]+$/, "");

    if (multiChap) {
        await Bun.spawn(["mkdir", "-p", outDir]).exited;
        console.log(`[bjtriz] Thư mục output: ${outDir}/`);
    }

    let chapDone = 0;

    for (const chap of toDownload) {
        const chapUrl = `${BJTRIZ_ORIGIN}/book/chapter/${chap.id}`;
        process.stdout.write(`[bjtriz] [${chapDone + 1}/${toDownload.length}] ${chap.name}... `);

        const html = await fetch(chapUrl, { headers: BJTRIZ_HEADERS }).then((r) => r.text());
        const { title, lines } = parseBjtrizChapterHtml(html, iconMap);
        console.log(`${lines.length} đoạn`);

        const content = (title ? `## ${title}\n\n` : "") + lines.join("\n");

        if (multiChap) {
            // Đánh số theo idx thực tế trong book, zero-padded
            const idxStr = String(chap.idx).padStart(4, "0");
            const safeName = chap.name.replace(/[/\\?%*:|"<>]/g, "_");
            const filePath = `${outDir}/${idxStr}_${safeName}.txt`;
            await Bun.write(filePath, content);
        } else {
            await Bun.write(outputFile, content);
        }

        chapDone++;

        // Nghỉ nhẹ giữa các request
        if (chapDone < toDownload.length) await Bun.sleep(300);
    }

    if (multiChap) {
        console.log(`[bjtriz] ✅ Đã lưu ${chapDone} chương vào thư mục "${outDir}/"`);
    } else {
        console.log(`[bjtriz] ✅ Đã lưu vào ${outputFile}`);
    }
}

// ─── zhihu.com ───────────────────────────────────────────────────────────────
async function mainZhihu() {
    const { page, browser } = await connectBrowser();

    const cookies = await parseCookies();

    if (Array.isArray(cookies)) {
        await browser.setCookie(...cookies);
    }

    await page.goto(url, { waitUntil: ["load", "networkidle0"] });

    await page.waitForSelector("#manuscript");

    const resutl = await page.$eval("#manuscript", (div) => {
        const fontFamily = getComputedStyle(div as HTMLElement).fontFamily;
        const textTags = div.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
        const result = Array.from(textTags).map(
            (el: Element) => el.textContent?.trim() || "",
        );

        const fontKey = fontFamily.split(",")[0]?.trim();

        const fonts: { name: string; src: string }[] = [];

        for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
                rules = (sheet as CSSStyleSheet).cssRules;
            } catch {
                // Bỏ qua nếu không thể truy cập (ví dụ CORS)
                continue;
            }
            for (const r of Array.from(rules)) {
                if (r instanceof CSSFontFaceRule) {
                    const ffRule = r as CSSFontFaceRule;
                    const ffFamily = ffRule.style
                        .getPropertyValue("font-family")
                        .replace(/["']/g, "")
                        .trim();
                    if (ffFamily === fontKey) {
                        fonts.push({
                            name: fontKey,
                            src: ffRule.style.getPropertyValue("src"),
                        });
                    }
                }
            }
        }

        return { lines: result, fonts };
    });

    await page.close();
    await browser.close();

    const charsMap = new Map<string, string>();

    if (resutl.fonts.length > 0) {
        for (const font of resutl.fonts) {
            const fontPath = await decodeFont(font);

            const fontXml = await Bun.file(fontPath).text();

            const glyphs = await dumpFont(fontXml);

            for (const glyph of glyphs) {
                const match = (map as Record<string, string>)[glyph.md5];
                if (!match) continue;

                charsMap.set(
                    codePointToChar(glyph.code),
                    codePointToChar(match),
                );
            }
        }
    }

    const lines = resutl.lines.map((line) =>
        Array.from(line)
            .map((ch) => charsMap.get(ch) ?? ch)
            .join(""),
    );

    await Bun.write(outputFile, lines.join("\n"));
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────
async function main() {
    const site = detectSite(url);
    console.log(`[site] Detected: ${site} (${url})`);

    if (site === "bjtriz") {
        await mainBjtriz();
    } else if (site === "zhihu") {
        await mainZhihu();
    } else {
        console.error(`❌ URL không được hỗ trợ: ${url}`);
        console.error("Các site được hỗ trợ: zhihu.com, bjtriz.com");
        process.exit(1);
    }
}

async function run() {
    try {
        if (isLogin) {
            await login();
        } else {
            await main();
        }
    } catch (error) {
        console.error(error);
    }
}

run();
