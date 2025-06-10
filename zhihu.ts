import os from "os";
import readline from "readline";
import { connect } from "puppeteer-real-browser";
import { type Cookie } from "rebrowser-puppeteer-core";

import { dumpFont } from "./font";
import { decodeFont, codePointToChar } from "./utils";

import map from "./SourceHanSansCN-Regular.json";

if (process.argv.length < 3) {
    console.log("Usage: zhihu [...options] <zhihu url>");
    process.exit(1);
}

let url = "";
let isLogin = false;
let chromePath = "";
let outputFile = "output.txt";
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

async function main() {
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
