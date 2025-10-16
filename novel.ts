#!/usr/bin/env bun
import { JSDOM } from "jsdom";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const supportDomains = ["togetherii.com", "welove-gourmet.com", "niice-woker.com"];

interface Chapter {
    url: string;
    title: string;
}

interface CliOptions {
    dir?: string;
    start?: number;
    end?: number;
    positionals: string[];
}

async function paserChapterList(url: string) {
    const pageUrl = new URL(url);
    const { hostname } = pageUrl;
    if (!supportDomains.includes(hostname)) {
        throw new Error(`Unsupported domain: ${hostname}`);
    }
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const ulElm = document.getElementById("chapterlist");
    if (!ulElm) throw new Error("Chapter list not found");

    const liElms = ulElm.querySelectorAll("li");
    if (!liElms) throw new Error("Chapter list items not found");

    return Array.from(liElms).map((liElm): Chapter => {
        const aElm = liElm.querySelector("a");
        if (!aElm) throw new Error("Chapter link not found");
        const href = aElm.getAttribute("href");
        if (!href) throw new Error("Chapter link not found");
        const titleElm = aElm.querySelector("em");
        const titleText = titleElm?.textContent?.trim();
        if (!titleText) throw new Error("Chapter title not found");

        const resolvedUrl = new URL(href, pageUrl).toString();
        return { url: resolvedUrl, title: titleText };
    });
}

async function paserChapter(url: string, texts: string[] = []) {
    // Kiểm tra domain
    const validUrl = /\/book\/chapter\/(\d{8,})/;
    if (!validUrl.test(url)) throw new Error("Invalid chapter url");

    const chapId = validUrl.exec(url)![1]!;

    const { hostname } = new URL(url);
    if (!supportDomains.includes(hostname)) {
        throw new Error(`Unsupported domain: ${hostname}`);
    }

    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const novelcontentElm = document.querySelector(".novelcontent");
    if (!novelcontentElm) throw new Error("Novel content not found");

    // 1️⃣ Tạo bảng ánh xạ class icon → ký tự thật
    const iconMap: Record<string, string> = {};
    const styleElms = document.querySelectorAll("style");
    for (const styleElm of styleElms) {
        const css = styleElm.textContent;
        if (!css) continue;

        // match ví dụ: .icon-122:before { content: "\65e5"; }
        const regex = /\.icon-(\d+):before\s*\{\s*content:\s*["']\\([0-9a-fA-F]+)["'];\s*\}/g;
        let match;
        while ((match = regex.exec(css))) {
            const iconId = match[1];
            const hexCode = match[2];
            if (!hexCode) continue;
            iconMap[`icon-${iconId}`] = String.fromCharCode(parseInt(hexCode, 16));
        }
    }

    // 2️⃣ Duyệt từng <p>, thay thế <i class="icon-xxx">
    const pElms = novelcontentElm.querySelectorAll("p");
    if (!pElms || pElms.length === 0) throw new Error("Novel content paragraphs not found");

    texts.push(
        ...Array.from(pElms).map((pElm) => {
            // clone innerHTML để xử lý
            let html = pElm.innerHTML;
            html = html.replace(/<i class="icon-(\d+)"><\/i>/g, (_, num) => {
                const key = `icon-${num}`;
                return iconMap[key] || ""; // thay thế bằng ký tự thật
            });

            // parse lại thành text thuần
            const temp = new JSDOM(html).window.document.body;
            const textContent = temp.textContent?.trim() ?? "";
            return textContent;
        })
    );

    // console.log(texts.join("\n"));

    // TODO: Kiểm tra link trong phần tử .nextbox
    const nextElm = document.querySelector(".nextbox>a");
    if (nextElm && nextElm.getAttribute("href")) {
        // Kiểm tra query pi trong url, nếu có pi > 1 thì vẫn cùng 1 chap
        const nextUrl = new URL(nextElm.getAttribute("href")!, url);
        const pi = nextUrl.searchParams.get("pi");
        const nextChapId = nextUrl.pathname.match(validUrl)?.[1];

        if (pi && parseInt(pi) > 1 && nextChapId === chapId) {
            return paserChapter(nextUrl.toString(), texts);
        }
    }

    return texts;
}

function parseCliArgs(args: string[]): CliOptions {
    const positionals: string[] = [];
    const options: Record<string, string> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (!arg.startsWith("--")) {
            positionals.push(arg);
            continue;
        }

        const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
        if (!rawKey) continue;
        const key = rawKey.toLowerCase();
        if (inlineValue !== undefined) {
            options[key] = inlineValue;
            continue;
        }

        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
            options[key] = next;
            i++;
            continue;
        }

        options[key] = "";
    }

    const parsedStart = options.start !== undefined ? Number.parseInt(options.start, 10) : undefined;
    const parsedEnd = options.end !== undefined ? Number.parseInt(options.end, 10) : undefined;
    const normalizedStart = typeof parsedStart === "number" && Number.isFinite(parsedStart) ? parsedStart : undefined;
    const normalizedEnd = typeof parsedEnd === "number" && Number.isFinite(parsedEnd) ? parsedEnd : undefined;

    return {
        dir: options.dir,
        start: normalizedStart,
        end: normalizedEnd,
        positionals,
    };
}

function sanitizeFileName(title: string): string {
    return title
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")
        .replace(/\.+$/, "") || "chapter";
}

function padIndex(index: number, total: number): string {
    const maxDigits = String(total).length;
    return String(index).padStart(maxDigits, "0");
}

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd) {
        console.error("Usage: bun novel.ts <command> <url> [--dir path] [--start n] [--end m]");
        process.exit(1);
    }

    const { dir, start, end, positionals } = parseCliArgs(rest);
    const [url] = positionals;

    if (!url) {
        console.error("Usage: bun novel.ts <command> <url> [--dir path] [--start n] [--end m]");
        process.exit(1);
    }
    if (cmd === "list") {
        const chapters = await paserChapterList(url);
        if (!dir) {
            console.table(
                chapters.map((chapter, idx) => ({
                    index: idx + 1,
                    title: chapter.title,
                    url: chapter.url,
                }))
            );
        } else {
            const total = chapters.length;
            if (total === 0) {
                console.warn("No chapters found to export.");
                return;
            }
            const startValue = start ?? 1;
            const endValue = end ?? total;

            if (startValue < 1 || startValue > total) {
                console.error(`Invalid --start value. It should be between 1 and ${total}.`);
                process.exit(1);
            }
            if (endValue < startValue || endValue < 1) {
                console.error(`Invalid --end value. It should be greater or equal to --start and at most ${total}.`);
                process.exit(1);
            }

            const startIndex = startValue - 1;
            const endExclusive = Math.min(endValue, total);

            await mkdir(dir, { recursive: true });
            console.log(`Exporting chapters ${startValue} to ${endExclusive} into ${dir}`);

            const selectedChapters = chapters.slice(startIndex, endExclusive);
            for (let i = 0; i < selectedChapters.length; i++) {
                const chapter = selectedChapters[i]!;
                const paragraphs = await paserChapter(chapter.url);
                const safeTitle = sanitizeFileName(chapter.title);
                const fileName = `${padIndex(startIndex + i + 1, total)}-${safeTitle}.txt`;
                const filePath = join(dir, fileName);
                await writeFile(filePath, paragraphs.join("\n"), "utf8");
                console.log(`Saved chapter ${startIndex + i + 1}: ${filePath}`);
            }
            console.log("Export completed.");
        }
    } else if (cmd === "chapter") {
        await paserChapter(url);
    } else {
        console.error("Unknown command. Use 'list' or 'chapter'");
        process.exit(1);
    }
}

main();
