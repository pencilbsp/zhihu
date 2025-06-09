import os from "os";
import { connect } from "puppeteer-real-browser";
import { winOCR, macOCR } from "./utils";

declare global {
    interface Window {
        drawText?: (
            text: string,
            fontSize: number,
            padding?: number,
            fontFamily?: string,
        ) => HTMLCanvasElement;
    }
}

if (!process.argv[2]) {
    console.error("Usage: zhihu <url>");
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

chromePath = process.env.CHROME_PATH || chromePath;

async function main(url: string) {
    const { page, browser } = await connect({
        headless: false,
        customConfig: { chromePath },
        connectOption: { defaultViewport: null },
    });

    try {
        await page.evaluateOnNewDocument(() => {
            window.drawText = (
                text: string,
                fontSize: number,
                padding: number = 10,
                fontFamily: string = "CustomFont",
            ) => {
                // Tạo canvas “off-screen”
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d")!;

                // Bước 1: đo sample “Hg” để tính scale
                ctx.font = `${fontSize}px ${fontFamily}`;
                const m1 = ctx.measureText("Hg");
                const realH =
                    m1.actualBoundingBoxAscent + m1.actualBoundingBoxDescent;
                const scale = fontSize / realH;
                const adjustedSize = fontSize * scale;

                // Bước 2: đo đoạn text
                ctx.font = `${adjustedSize}px ${fontFamily}`;
                const m2 = ctx.measureText(text);
                const ascent = m2.actualBoundingBoxAscent;
                const descent = m2.actualBoundingBoxDescent;
                const textW = m2.width;
                const textH = ascent + descent;

                // Bước 3: set kích thước canvas lớn hơn để nét
                canvas.width = Math.ceil(textW + padding * 2);
                canvas.height = Math.ceil(textH + padding * 2);
                // Nếu muốn giữ kích thước CSS hiển thị, bạn có thể:
                // canvas.style.width = `${canvas.width / scale}px`;
                // canvas.style.height = `${canvas.height / scale}px`;

                const c2 = canvas.getContext("2d")!;
                // fill background trắng (tuỳ bạn)
                c2.fillStyle = "#fff";
                c2.fillRect(0, 0, canvas.width, canvas.height);

                // c2.scale(scale, scale);
                c2.font = `${fontSize}px ${fontFamily}`;
                c2.fillStyle = "#000";
                c2.textBaseline = "alphabetic";

                // vẽ text tại vị trí tính sẵn
                const x = padding;
                const y = padding + ascent;
                c2.fillText(text, x, y);

                return canvas;
            };
        });

        await page.goto(url, { waitUntil: ["load", "networkidle0"] });

        await page.waitForSelector("#manuscript");

        const arrayHandle = await page.evaluateHandle(() => {
            if (!window.drawText) return null;
            const div = document.querySelector("#manuscript")!;
            const items = Array.from(
                div.querySelectorAll("h1, h2, h3, h4, h5, h6, p"),
            );
            const handles: HTMLCanvasElement[] = [];
            for (const elm of items) {
                const txt = elm.textContent?.trim();
                if (!txt) continue;
                const fam = window.getComputedStyle(elm).fontFamily;
                const canvas = window.drawText(txt, 100, 10, fam);
                // append để screenshot được

                document.body.appendChild(canvas);
                handles.push(canvas);
            }
            return handles;
        });

        // 4. Lấy các ElementHandle từ arrayHandle
        const canvasHandles: any[] = [];
        const properties = await arrayHandle.getProperties();
        for (const handle of properties.values()) {
            const element = handle.asElement();
            if (element) canvasHandles.push(element);
        }

        // 5. Chụp từng canvas
        let results = [];
        for (let i = 0; i < canvasHandles.length; i++) {
            const buffer: Buffer = await canvasHandles[i].screenshot();
            let text: string;

            if (sys === "darwin") {
                text = await macOCR(buffer);
            } else {
                text = await winOCR(buffer);
            }

            const allText = text.trim().replace(/\n+/g, " ");
            console.log(i, allText);
            results.push(allText);
        }

        await Bun.write("output.txt", results.join("\n"));

        // 6. (tuỳ chọn) Dọn sạch
        await page.evaluate(() => {
            document.querySelectorAll("canvas").forEach((c) => {
                c.remove();
            });
        });

        await page.close();
        await browser.close();
    } catch (error) {
        await page.close();
        await browser.close();

        throw error;
    }
}

try {
    await main(process.argv[2]!);
} catch (error) {
    console.error(error);
}
