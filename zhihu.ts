import os from "os";
import { connect } from "puppeteer-real-browser";

import { dumpFont } from "./font";
import { decodeFont, codePointToChar } from "./utils";

import map from "./SourceHanSansCN-Regular.json";

if (!process.argv[2]) {
    console.log("Usage: zhihu <zhihu url>");
    process.exit(1);
}

let chromePath = "";
const sys = os.platform();

if (sys === "win32") {
    console.log("Running on Windows");
    chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
} else if (sys === "darwin") {
    console.log("Running on macOS");
    chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
} else {
    process.exit(1);
}

if (process.env.CHROME_PATH) {
    chromePath = process.env.CHROME_PATH;
}

async function main(url: string) {
    const { page, browser } = await connect({
        headless: false,
        customConfig: { chromePath },
        connectOption: { defaultViewport: null },
    });

    await page.goto(url, { waitUntil: ["load", "networkidle0"] });

    await page.waitForSelector("#manuscript");

    const resutl = await page.$eval("#manuscript", (div) => {
        const fontFamily = getComputedStyle(div as HTMLElement).fontFamily;
        const textTags = div.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
        const result = Array.from(textTags).map((el: Element) => el.textContent?.trim() || "");

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
                    const ffFamily = ffRule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
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

                charsMap.set(codePointToChar(glyph.code), codePointToChar(match));
            }
        }
    }

    const lines = resutl.lines.map((line) =>
        Array.from(line)
            .map((ch) => charsMap.get(ch) ?? ch)
            .join("")
    );

    await Bun.write("output.txt", lines.join("\n"));
}

async function run() {
    try {
        await main(process.argv[2]!);
    } catch (error) {
        console.error(error);
    }
}

run();
